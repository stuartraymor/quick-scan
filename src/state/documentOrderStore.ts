// SPDX-License-Identifier: AGPL-3.0-only
// The model tree's order, separate from the finite undo log. Keys refer to
// recipes, so visibility, failed builds and CAD rollback never erase rows.
import { create } from 'zustand'
import { useStore } from './store'
import { activeLocalHistory, historyAction, historyBlocked, registerHistory, useHistory } from './historyStore'
import { registerProjectSection } from '../app/projectSections'
import { onScan } from '../app/scanEvents'
import { elementFromJson, elementToJson, sectionFromJson, sectionToJson, type ElementJson, type ProjectManifest, type SectionJson } from '../core/project/manifest'
import { validateProjectParts } from '../core/project/validation'
import type { Element } from './elementModel'
import type { Section } from './sectionModel'
import type { Dimension } from '../core/dimensions'
import { registerMutationGuard, runningChange } from '../commands/registry'
import { CommandError } from '../commands/types'

export interface DocumentCoreArchive { elements: Element[]; sections: Section[]; dimensions: Dimension[] }

export interface DocumentOrderState {
  keys: readonly string[]
  /** Older files lack inter-workspace chronology. Their deterministic
   * migration is retained as such, including after saving again. */
  migrated: boolean
  /** Number of recipes before the End of Model marker; null builds all. */
  rollbackAt: number | null
  /** Full core recipes while the active store holds a rolled-back prefix. */
  coreArchive: DocumentCoreArchive | null
}
export const useDocumentOrder = create<DocumentOrderState>(() => ({ keys: [], migrated: false, rollbackAt: null, coreArchive: null }))

export interface DocumentOrderProvider {
  /** Namespace before the first colon, e.g. reverse. */
  id: string
  keys(): readonly string[]
  subscribe(changed: () => void): () => void
  /** Pure IDs from the saved recipes, used before live state is replaced.
   * Preserve recipe/build order, including rolled-back recipes. */
  projectKeys?(manifest: ProjectManifest): readonly string[]
  /** Apply an actual recipe rollback; keys are this owner's active prefix. */
  rollTo?(activeKeys: readonly string[]): void
  mutationActions?: DocumentMutationActions
}
export interface DocumentMutationActions {
  store: { getState(): object; setState(patch: object): void }
  names: readonly string[]
  refused?: Readonly<Record<string, unknown>>
  /** Legacy owner-only rollback is routed through the common boundary. */
  rollAction?: string
}
interface RegisteredProvider { provider: DocumentOrderProvider; stop?: () => void; stopGuard?: () => void }
const providers = new Map<string, RegisteredProvider>()
let installed = false
let applyingProject = 0
let applyGeneration = 0
let navigating = false
export const DOCUMENT_HISTORY_READ_ONLY = 'The model is rolled back. Move End of Model to the end before creating, editing or deleting geometry.'
export const documentHistoryReadOnly = (): boolean => useDocumentOrder.getState().rollbackAt !== null

function guardActions(actions: DocumentMutationActions, provider?: DocumentOrderProvider): () => void {
  const store = actions.store as { getState(): Record<string, unknown>; setState(patch: Record<string, unknown>): void }
  const originals = store.getState()
  const patch: Record<string, unknown> = {}
  for (const name of actions.names) {
    const original = originals[name]
    if (typeof original !== 'function') throw new Error(`Missing guarded model action: ${name}.`)
    patch[name] = (...args: unknown[]) => {
      const internal = navigating || applyingProject !== 0 || useHistory.getState().restoring || useHistory.getState().importing
      if (!internal && provider && name === actions.rollAction) {
        const keys = checkedProviderKeys(provider)
        const count = args[0] === null ? keys.length : Number(args[0])
        if (!Number.isFinite(count)) return undefined
        const next = keys[Math.min(keys.length, Math.max(0, Math.round(count)))]
        applyDocumentHistoryBoundary(next === undefined ? null : useDocumentOrder.getState().keys.indexOf(next), runningChange() !== null)
        return undefined
      }
      // A command admitted while the model was complete may temporarily
      // roll CAD to make an insertion, then restore End within that same
      // command. New commands are refused at the registry before starting.
      if (!internal && !runningChange() && documentHistoryReadOnly()) {
        useStore.getState().setError(DOCUMENT_HISTORY_READ_ONLY)
        return actions.refused?.[name]
      }
      return original(...args)
    }
  }
  store.setState(patch)
  return () => {
    const restore: Record<string, unknown> = {}
    for (const name of actions.names) if (store.getState()[name] === patch[name]) restore[name] = originals[name]
    store.setState(restore)
  }
}

function coreMutationActions(): DocumentMutationActions {
  const names = Object.entries(useStore.getState()).filter(([name, value]) => typeof value === 'function' &&
    /^(start|edit|commit|remove|setDraft|setSectionDraft|setAlignment|setDimension|begin.*Pick|addAlignmentPick|selectAlignmentElement|selectDimensionElement|pickDraftPoint|applyAlignment|clearAppliedAlignment|proposeAlignment|restartDraft|restoreDraft)/.test(name)).map(([name]) => name)
  return { store: useStore, names, refused: { commitDraft: null, commitSection: null, pickDraftPoint: null } }
}

const namespace = (key: string) => key === 'scan' ? 'core' : key.split(':', 1)[0]
const validKey = (key: unknown): key is string => typeof key === 'string' && (key === 'scan' ||
  /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*:(0|[1-9][0-9]*)$/.test(key) && Number.isSafeInteger(Number(key.slice(key.lastIndexOf(':') + 1))))
const equalKeys = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((key, i) => key === b[i])

function coreKeys(scan: { elements: readonly { id: number }[]; sections?: readonly { id: number }[] } | null): string[] {
  if (!scan) return []
  return ['scan', ...[
    ...scan.elements.map(({ id }) => ({ id, key: `core:element:${id}` })),
    ...(scan.sections ?? []).map(({ id }) => ({ id, key: `core:section:${id}` })),
  ].sort((a, b) => a.id - b.id || a.key.localeCompare(b.key)).map(({ key }) => key)]
}

function liveCoreKeys(): string[] {
  const s = useStore.getState()
  const archive = useDocumentOrder.getState().coreArchive
  // Core recipes can exist on a scanless stage in tests/commands too.
  const keys = coreKeys(archive ?? { elements: s.elements, sections: s.sections })
  return s.fileName ? keys : keys.slice(1)
}

function checkedProviderKeys(provider: DocumentOrderProvider, keys = provider.keys()): string[] {
  const seen = new Set<string>()
  for (const key of keys) {
    if (!validKey(key) || namespace(key) !== provider.id || seen.has(key)) throw new Error(`Invalid document order key from ${provider.id}.`)
    seen.add(key)
  }
  return [...keys]
}

/** Reconcile one owner without changing the positions of other owners.
 * New recipes append, except insertion ahead of an existing owner's recipe
 * (such as creating at a CAD rollback bar). Owner reorder replaces only its
 * existing slots, preserving the other workspaces' positions. */
function mergeOwner(previous: readonly string[], owner: string, live: readonly string[]): string[] {
  const wanted = new Set(live)
  const out = previous.filter((key) => namespace(key) !== owner || wanted.has(key))
  for (let i = 0; i < live.length; i++) {
    const key = live[i]
    if (out.includes(key)) continue
    const following = live.slice(i + 1).find((next) => out.includes(next))
    const at = following === undefined ? out.length : out.indexOf(following)
    out.splice(at, 0, key)
  }
  let index = 0
  const ordered = out.map((key) => namespace(key) === owner ? live[index++] : key)
  // The source scan is the document's root, even when added to scanless CAD.
  return ordered.includes('scan') ? ['scan', ...ordered.filter((key) => key !== 'scan')] : ordered
}

function suspended(): boolean {
  const history = useHistory.getState()
  return navigating || applyingProject !== 0 || history.restoring || history.importing
}

function reconcile(owner?: string): void {
  if (!installed || suspended()) return
  const current = useDocumentOrder.getState()
  let keys = current.keys
  if (!owner || owner === 'core') keys = mergeOwner(keys, 'core', liveCoreKeys())
  for (const { provider } of providers.values()) if (!owner || owner === provider.id) keys = mergeOwner(keys, provider.id, checkedProviderKeys(provider))
  if (!equalKeys(keys, current.keys)) useDocumentOrder.setState({ keys })
}

/** Plugins register directly without the app importing their implementation. */
export function registerDocumentOrderProvider(provider: DocumentOrderProvider): () => void {
  if (!/^[a-z][a-z0-9-]*$/.test(provider.id) || provider.id === 'core' || providers.has(provider.id)) throw new Error(`Duplicate or reserved document order provider: ${provider.id}.`)
  checkedProviderKeys(provider)
  const registered: RegisteredProvider = { provider }
  providers.set(provider.id, registered)
  if (installed) {
    registered.stop = provider.subscribe(() => reconcile(provider.id))
    if (provider.mutationActions) registered.stopGuard = guardActions(provider.mutationActions, provider)
    reconcile(provider.id)
  }
  return () => {
    registered.stop?.()
    registered.stopGuard?.()
    providers.delete(provider.id)
    // Its saved keys remain available to a future build that owns them.
  }
}

interface SavedOrder {
  version: 1
  keys: string[]
  migrated?: boolean
  rollback?: { at: number; core: { elements: ElementJson[]; sections: SectionJson[]; dimensions: Dimension[] } }
}
function savedOrder(value: unknown): SavedOrder | undefined {
  if (value === undefined) return undefined
  const part = value as Partial<SavedOrder> | null
  if (!part || typeof part !== 'object' || Array.isArray(part) || part.version !== 1 || !Array.isArray(part.keys) ||
    !part.keys.every(validKey) || new Set(part.keys).size !== part.keys.length ||
    (part.migrated !== undefined && typeof part.migrated !== 'boolean')) throw new Error('Malformed project: documentOrder.')
  if (part.rollback !== undefined) {
    const rollback = part.rollback
    if (!rollback || typeof rollback !== 'object' || !Number.isSafeInteger(rollback.at) || rollback.at < 0 || rollback.at >= part.keys.length ||
      part.keys.indexOf('scan') >= rollback.at || !rollback.core || typeof rollback.core !== 'object' ||
      !Array.isArray(rollback.core.elements) || !Array.isArray(rollback.core.sections) || !Array.isArray(rollback.core.dimensions)) throw new Error('Malformed project: documentOrder.rollback.')
  }
  return { version: 1, keys: [...part.keys], migrated: part.migrated, rollback: part.rollback }
}

function preparedOrder(value: unknown, manifest: ProjectManifest): DocumentOrderState {
  const saved = savedOrder(value)
  let coreArchive: DocumentCoreArchive | null = null
  if (saved?.rollback) {
    const core = saved.rollback.core
    if (!manifest.scan && core.elements.length + core.sections.length + core.dimensions.length > 0) throw new Error('Malformed project: rolled-back core recipes require their scan.')
    if (manifest.scan) validateProjectParts({ ...manifest, scan: { ...manifest.scan, ...core } })
    coreArchive = {
      elements: core.elements.map((element) => elementFromJson(element, manifest.scan!.settings)),
      sections: core.sections.map(sectionFromJson),
      dimensions: core.dimensions,
    }
  }
  let keys: readonly string[] = saved?.keys ?? []
  const archivedKeys = coreArchive ? coreKeys(coreArchive) : null
  const known: [string, readonly string[]][] = [['core', archivedKeys ? (manifest.scan ? archivedKeys : archivedKeys.slice(1)) : coreKeys(manifest.scan)]]
  for (const { provider } of providers.values()) if (provider.projectKeys) known.push([provider.id, checkedProviderKeys(provider, provider.projectKeys(manifest))])
  let missing = false
  for (const [owner, ownerKeys] of known) {
    if (ownerKeys.some((key) => !keys.includes(key))) missing = true
    keys = mergeOwner(keys, owner, ownerKeys)
  }
  const rollbackAt = saved?.rollback?.at ?? null
  if (rollbackAt !== null) {
    // A corrupt marker must never make a saved active entity disappear or
    // leave active recipes below its own position when the project opens.
    const active = new Set(keys.slice(0, rollbackAt))
    const allCore = coreKeys(coreArchive)
    const currentCore = new Set(coreKeys(manifest.scan))
    if (allCore.some((key) => active.has(key) !== currentCore.has(key))) throw new Error('Malformed project: documentOrder active recipes.')
  }
  return { keys, migrated: Boolean(saved?.migrated || missing && keys.length > 0), rollbackAt, coreArchive }
}

/** Move the real recipe boundary. Scan geometry stays loaded; core recipes
 * below the marker leave the active store and CAD uses its actual rollback.
 * The full recipes remain available for Next, project save and Undo/Redo. */
function applyDocumentHistoryBoundary(at: number | null, commandNavigation = false): boolean {
  if (!installed || suspended() || historyBlocked() && !commandNavigation || activeLocalHistory()) return false
  const state = useDocumentOrder.getState()
  const minimum = state.keys.includes('scan') ? 1 : 0
  const wanted = at === null ? state.keys.length : Math.min(state.keys.length, Math.max(minimum, Math.round(at)))
  if (!Number.isFinite(wanted)) return false
  const boundary = wanted === state.keys.length ? null : wanted
  if (boundary === state.rollbackAt) return false
  const active = new Set(state.keys.slice(0, wanted))
  // Every provider containing future recipes must implement real rollback.
  if ([...providers.values()].some(({ provider }) => !provider.rollTo && provider.keys().some((key) => !active.has(key)))) return false
  historyAction('History: move End of Model', () => {
    navigating = true
    try {
      const s = useStore.getState()
      const archive = state.coreArchive ?? { elements: s.elements, sections: s.sections, dimensions: s.dimensions }
      const elements = archive.elements.filter((element) => active.has(`core:element:${element.id}`))
      const sections = archive.sections.filter((section) => active.has(`core:section:${section.id}`))
      const ids = new Set([...elements.map((element) => element.id), ...sections.map((section) => section.id)])
      const dimensions = boundary === null ? archive.dimensions : archive.dimensions.filter((dimension) => dimension.refs.every((ref) => ref === null || ids.has(ref)))
      useDocumentOrder.setState({ rollbackAt: boundary, coreArchive: boundary === null ? null : archive })
      useStore.setState({ elements, sections, dimensions })
      for (const { provider } of providers.values()) provider.rollTo?.(checkedProviderKeys(provider).filter((key) => active.has(key)))
    } finally { navigating = false }
  })
  return true
}

export const setDocumentHistoryBoundary = (at: number | null): boolean => applyDocumentHistoryBoundary(at)

export function documentHistoryStep(direction: -1 | 1): boolean {
  const state = useDocumentOrder.getState()
  return setDocumentHistoryBoundary((state.rollbackAt ?? state.keys.length) + direction)
}
export const documentHistoryToEnd = (): boolean => setDocumentHistoryBoundary(null)

/** Install once, before rendering/history wrappers; returns cleanup for tests.
 * Project preparation is pure. Its apply holds subscriptions through the
 * synchronous core/plugin restore loop, then reconciles any later additions.
 * This also covers non-browser callers of prepareProjectState(). */
export function installDocumentOrder(): () => void {
  if (installed) throw new Error('Document order is already installed.')
  installed = true
  let hadScan = Boolean(useStore.getState().fileName)
  const stops = [
    guardActions(coreMutationActions()),
    registerMutationGuard((name, command) => {
      if (!documentHistoryReadOnly() || command.readOnly || command.interrupts ||
        ['history.undo', 'history.redo', 'history.restore', 'session.reset', 'project.load', 'scan.open', 'workspace.set', 'project.rename'].includes(name) || name.endsWith('.set_visible')) return
      throw new CommandError('invalid_state', DOCUMENT_HISTORY_READ_ONLY)
    }),
    registerProjectSection<SavedOrder>({
      key: 'documentOrder',
      collect: () => {
        const s = useDocumentOrder.getState()
        return s.keys.length ? {
          version: 1, keys: [...s.keys], ...(s.migrated ? { migrated: true } : {}),
          ...(s.rollbackAt !== null && s.coreArchive ? { rollback: { at: s.rollbackAt, core: {
            elements: s.coreArchive.elements.map(elementToJson), sections: s.coreArchive.sections.map(sectionToJson), dimensions: s.coreArchive.dimensions,
          } } } : {}),
        } : undefined
      },
      prepare: (value, { manifest }) => {
        const prepared = preparedOrder(value, manifest)
        return () => {
          const generation = ++applyGeneration
          applyingProject = generation
          useDocumentOrder.setState(prepared)
          hadScan = manifest.scan !== null
          queueMicrotask(() => {
            if (generation !== applyGeneration) return
            applyingProject = 0
            reconcile()
          })
        }
      },
      // Metadata alone is not an otherwise empty document worth saving.
      hasContent: () => false,
      watch: (changed) => useDocumentOrder.subscribe((s, prev) => { if (s.keys !== prev.keys || s.migrated !== prev.migrated || s.rollbackAt !== prev.rollbackAt || s.coreArchive !== prev.coreArchive) changed() }),
    }),
    registerHistory({ sections: [{
      key: 'documentOrder',
      capture: () => ({ ...useDocumentOrder.getState() }),
      apply: (value) => useDocumentOrder.setState(value as DocumentOrderState),
    }] }),
    useStore.subscribe((s, prev) => {
      const archive = useDocumentOrder.getState().coreArchive
      // Visibility is viewing, not geometry editing. Keep the active rows'
      // eye choices when their complete recipe list is restored with Next.
      if (archive && !suspended()) {
        let changed = false
        const visibility = <T extends { id: number; visible?: boolean }>(all: T[], active: T[]): T[] => all.map((entry) => {
          const shown = active.find((item) => item.id === entry.id)
          if (!shown || shown.visible === entry.visible) return entry
          changed = true
          return { ...entry, visible: shown.visible }
        })
        const elements = visibility(archive.elements, s.elements)
        const sections = visibility(archive.sections, s.sections)
        const dimensions = visibility(archive.dimensions, s.dimensions)
        if (changed) useDocumentOrder.setState({ coreArchive: { elements, sections, dimensions } })
      }
      if (s.elements !== prev.elements || s.sections !== prev.sections || s.fileName !== prev.fileName) reconcile('core')
    }),
    onScan({ loaded: (scan) => {
      const previousScan = hadScan
      hadScan = scan !== null
      if (!scan || previousScan) {
        // The plugin's scan listener resets its own recipes in this event.
        useDocumentOrder.setState({ keys: scan ? ['scan'] : [], migrated: false, rollbackAt: null, coreArchive: null })
      } else {
        useDocumentOrder.setState((s) => ({ keys: ['scan', ...s.keys.filter((key) => key !== 'scan')] }))
      }
    } }),
    useHistory.subscribe((s, prev) => {
      if ((prev.importing && !s.importing || prev.restoring && !s.restoring) && !applyingProject) reconcile()
    }),
  ]
  for (const registered of providers.values()) {
    registered.stop = registered.provider.subscribe(() => reconcile(registered.provider.id))
    if (registered.provider.mutationActions) registered.stopGuard = guardActions(registered.provider.mutationActions, registered.provider)
  }
  reconcile()
  return () => {
    installed = false
    ++applyGeneration
    applyingProject = 0
    for (const stop of stops.reverse()) stop()
    for (const registered of providers.values()) {
      registered.stop?.(); registered.stop = undefined
      registered.stopGuard?.(); registered.stopGuard = undefined
    }
  }
}
