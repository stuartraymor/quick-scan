// SPDX-License-Identifier: AGPL-3.0-only
// Saving the session as a project and opening one, outside React: the data
// half is in ./project, the archive in core/project, the document identity
// in state/documentStore. What is here is the order things have to happen in
// on load — scan, its alignment, reference, image, then the stores, then
// everything measured rather than stored — and it is the one copy of it: the
// app's useProject wraps it with the project worker and the recovery
// checkpoint, a headless session (tests, the MCP kit) with the archive
// functions and no checkpoint, so project.save / project.load run the same
// code as the Save and Open buttons.

import type { RefObject } from 'react'
import { meshUnitsOf } from '../core/meshUnits'
import type { ElementKind } from '../core/types'
import type { MeshWorkerClient } from '../core/workerClient'
import type { SceneManager } from '../viewer/SceneManager'
import { captureProjectView, readProjectView } from '../viewer/projectView'
import { useStore } from '../state/store'
import { creaseSetting } from '../core/geometry/crease'
import { useDeviation } from '../state/deviationStore'
import { useThickness } from '../state/thicknessStore'
import { useFlat } from '../state/flatStore'
import { saveTarget, useDocument } from '../state/documentStore'
import { forgetKeptParts, keepUnownedParts, projectSections } from './projectSections'
import type { ArchiveMember, UnpackedProject } from '../core/project/archive'
import { PROJECT_EXTENSION, projectStem, rigidFromJson, type ProjectManifest } from '../core/project/manifest'
import { recentProjectTargets, type ProjectWriter } from './projectWriter'
import { saveFile } from './exports'
import { blankManifest, prepareProjectState, collectProject, projectHasContent, readAs, sessionIsDirty, type SourceFiles } from './project'
import { APP_VERSION } from '../version'
import type { PackedProject } from '../commands/host'
import type { ImportQueue } from './importQueue'
import { prepareScan, prepareNominal, prepareImage, runImport, type PreparedScan, type PreparedNominal, type PreparedImage } from './imports'
import { bundleFiles } from './scanFiles'
import type { ProjectSnapshot } from './projectSnapshot'

/** Packing and reading the archive — the worker in the app, the functions headless. */
export interface ProjectArchive {
  pack(manifest: ProjectManifest, members: ArchiveMember[]): Promise<Uint8Array>
  unpack(bytes: Uint8Array): Promise<UnpackedProject>
  /** Called after a failure, for a worker that may have died. */
  failed?(): void
}

/** The unsaved-work bookkeeping — the recovery checkpoint in the app, nothing headless. */
export interface SavedWatch {
  markSaved(snapshot: ProjectSnapshot): void
  restored(): void
  dirty(): boolean
}

export interface ProjectIoDeps {
  sources: RefObject<SourceFiles>
  clientRef: RefObject<MeshWorkerClient | null>
  sceneRef: RefObject<SceneManager | null>
  elementScope: RefObject<Uint32Array | null>
  imports: ImportQueue
  commitScan: (scan: PreparedScan | null) => void
  commitNominal: (nominal: PreparedNominal | null) => void
  commitImage: (image: PreparedImage | null) => void
  runEdgeDetect: () => Promise<void>
  runFit: (id: number, kind: ElementKind, seeds: number[], selection?: Uint32Array, regionsOnly?: boolean) => Promise<void>
  runDeviation: () => Promise<void>
  runThickness: () => Promise<void>
  archive: ProjectArchive
  saved: SavedWatch
  /** The desktop's native writer, when there is one; else the file is downloaded. */
  writer?: () => ProjectWriter | undefined
  download?: (name: string, bytes: Uint8Array) => void
  /** Asks before work is lost; headless there is nobody to ask, so it answers no. */
  confirm: (message: string) => boolean
}

export const noSavedWatch: SavedWatch = { markSaved() {}, restored() {}, dirty: () => sessionIsDirty() }

export function createProjectIo(deps: ProjectIoDeps) {
  const { sources, clientRef, sceneRef, elementScope, imports, archive, saved } = deps
  const download = deps.download ?? ((name, bytes) => saveFile(name, new Blob([bytes as BlobPart], { type: 'application/zip' })))

  const capture = (): ProjectSnapshot => {
    const snapshot = collectProject(sources.current, elementScope.current, APP_VERSION)
    if (sceneRef.current) snapshot.manifest.viewport = captureProjectView(sceneRef.current.viewLink())
    return snapshot
  }

  /** The session as a project file, and the session marked saved — what
   *  Save Project downloads and project.save hands back. project.save
   *  returns bytes to the AI host; desktop UI saves also wait for the
   *  native write, keeping the captured snapshot dirty on cancellation. */
  const pack = (destination: 'host' | 'save' | 'saveAs') => imports.run(async (): Promise<PackedProject> => {
    const store = useStore.getState()
    if (!projectHasContent(sources.current)) return { error: 'There is nothing to save yet — no scan, image or work.' }
    store.setError(null)
    useStore.setState({ busy: true, statusText: 'Saving project…' })
    try {
      const snapshot = capture()
      const { manifest, members } = snapshot
      const bytes = await archive.pack(manifest, members)
      const stem = projectStem(store.projectName, store.fileName, useFlat.getState().imageName)
      const name = `${stem}.${PROJECT_EXTENSION}`
      if (destination !== 'host') {
        const writer = deps.writer?.()
        if (writer?.saveProject) {
          // Only a file this document was opened from or saved to is written
          // without asking (state/documentStore): a scan or example opened
          // since is a new document, and Save asks where.
          const target = saveTarget()
          const result = await writer.saveProject(name, bytes, destination === 'saveAs', target.token, target.file)
          if (result.canceled) {
            useStore.setState({ busy: false, statusText: 'Save canceled.' })
            return { error: 'Save canceled.' }
          }
          useDocument.getState().savedTo(result.token)
        } else {
          download(name, bytes)
        }
      }
      saved.markSaved(snapshot)
      useStore.setState({ busy: false, statusText: `Project saved — ${(bytes.byteLength / 1e6).toFixed(1)} MB.` })
      return { name, bytes }
    } catch (e) {
      archive.failed?.()
      useStore.setState({ busy: false, statusText: '' })
      const error = `The project could not be saved — ${e instanceof Error ? e.message : String(e)}`
      store.setError(error)
      return { error }
    }
  })

  /** Open a project in place of the session — after asking, when there is
   *  work to lose, unless the caller has settled that (`settled`). */
  const openProject = (file: File, recovered = false, settled = false) => runImport(imports, 'Reading project…', async () => {
    const meshClient = clientRef.current!
    let scan: PreparedScan | null = null
    let nominal: PreparedNominal | null = null
    let image: PreparedImage | null = null
    let committed = false
    try {
      const { manifest, members } = await archive.unpack(new Uint8Array(await file.arrayBuffer()))
      const applyState = prepareProjectState(manifest, members)
      const memberFile = (member: string, name: string) => {
        const bytes = members.get(member)
        if (!bytes) throw new Error(`Project is missing ${member}.`)
        return new File([bytes as BlobPart], name)
      }
      // Check every referenced member before allocating candidate geometry.
      const scanFile = manifest.scan && memberFile(manifest.scan.member, readAs(manifest.scan.fileName, manifest.scan.member))
      // The files that came with it, under the names they came under.
      const companions = (manifest.scan?.companions ?? []).map((c) => memberFile(c.member, c.fileName))
      const ref = manifest.deviation.reference
      const nominalFile = ref && memberFile(ref.member, ref.fileName)
      const img = manifest.flat.image
      const imageFile = img && memberFile(img.member, img.fileName)
      const alignment = manifest.scan?.appliedAlignment ? rigidFromJson(manifest.scan.appliedAlignment) : null
      if (alignment && (alignment.r.length !== 9 || alignment.t.length !== 3 || ![...alignment.r, ...alignment.t].every(Number.isFinite))) {
        throw new Error('Malformed project: scan alignment.')
      }
      const scope = manifest.deviation.scope ? Uint32Array.from(manifest.deviation.scope) : null
      // Preparation never changes stores, original bytes, the viewport, or
      // the worker's current scan/reference. Any member may still fail here.
      // A member saved in other units is read in millimetres from them again,
      // the way it was when it came in; the manifest checked the value.
      if (scanFile) scan = await prepareScan(meshClient, sceneRef.current, bundleFiles([scanFile, ...companions])!, creaseSetting(useStore.getState()), alignment ?? undefined, meshUnitsOf(manifest.scan?.units) ?? 'mm') // units-ok: the file's own units, an id
      if (nominalFile) nominal = await prepareNominal(meshClient, sceneRef.current, nominalFile, meshUnitsOf(ref?.units) ?? 'mm') // units-ok: the file's own units, an id
      if (imageFile) image = await prepareImage(imageFile)

      await meshClient.commitImport({ scan: scan?.id ?? null, nominal: nominal?.id ?? null })
      deps.commitScan(scan)
      deps.commitNominal(nominal)
      deps.commitImage(image)
      committed = true
      // From here the session is this project's document; the file is
      // written back only once it has opened whole (below).
      useDocument.getState().startNew(recovered ? 'recovered' : 'new')
      // The scan keeps the name it was opened under, whatever the file it
      // is now kept as.
      useStore.setState({ appliedAlignment: alignment, ...(manifest.scan ? { fileName: manifest.scan.fileName } : {}) })
      elementScope.current = scope
      applyState()
      useDeviation.setState((s) => ({ scopeVersion: s.scopeVersion + 1 }))
      // What of the project no section here owns is kept, to be written back.
      const unowned = keepUnownedParts(manifest, members)
      void deps.runEdgeDetect()

      // What the sections keep in the archive's own files, back in place —
      // before anything is measured, which may be measured on it.
      const present = projectSections().filter((s) => manifest[s.key] !== undefined)
      for (const section of present) await section.restore?.(manifest[section.key], { manifest, members })

      // ---- everything measured rather than stored ----
      const jobs: Promise<void>[] = []
      for (const el of useStore.getState().elements) {
        if (el.source.type !== 'fitted') continue
        // The fit as saved stands: only the surface it was measured on is
        // read again. Fitted anew it can land elsewhere, and what was built
        // on it moves with no edit (one without a saved fit is fitted).
        jobs.push(deps.runFit(el.id, el.kind, el.source.seeds, el.source.selection, true))
      }
      await Promise.all(jobs)
      if (manifest.scan && manifest.deviation.align && useDeviation.getState().nominalName) {
        await deps.runDeviation()
      }
      if (manifest.scan && manifest.thickness.measured) await deps.runThickness()
      for (const section of present) await section.remeasure?.(manifest[section.key], { manifest, members })
      useThickness.setState({ probes: manifest.thickness.probes })
      useDeviation.setState({ probes: manifest.deviation.probes })

      // Establish navigation bounds first; old files share the import pose.
      sceneRef.current?.frameAll('iso')
      const view = readProjectView(manifest.viewport)
      if (view) sceneRef.current?.restoreProjectView(view)
      useStore.setState({
        busy: false,
        statusText: `Project opened — ${file.name}.${unowned.length > 0 ? ' It also holds work this build has no workspace for; that is kept, and saved with the project.' : ''}`,
      })
      if (recovered) {
        useDocument.getState().startNew('recovered')
        saved.restored()
      } else {
        useDocument.getState().openedProject(file, recentProjectTargets.get(file) ?? null)
        saved.markSaved(capture())
      }
    } catch (e) {
      archive.failed?.()
      throw e
    } finally {
      scan?.view.dispose()
      nominal?.view.dispose()
      if (!committed) image?.bitmap.close()
      await meshClient.discardImport([scan?.id, nominal?.id].filter((id): id is number => id !== undefined))
    }
  }, () => settled || !sessionIsDirty() || deps.confirm('Opening a project replaces the measurements in this session. Continue?'))

  /** Start a new project in place of the session: the scan, the reference
   *  and the image closed, every measurement and every workspace's work let
   *  go, the settings back to the app's own and the name taken off — what
   *  opening an empty project does, in the workspace on screen. After
   *  asking, when there are changes not saved, unless the caller has
   *  settled that (`settled`). */
  const newProject = (settled = false) => runImport(imports, 'Starting a new project…', async () => {
    const applyState = prepareProjectState(blankManifest(APP_VERSION))
    await clientRef.current!.commitImport({ scan: null, nominal: null })
    deps.commitScan(null)
    deps.commitNominal(null)
    deps.commitImage(null)
    useStore.setState({ appliedAlignment: null })
    elementScope.current = null
    applyState()
    useDeviation.setState((s) => ({ scopeVersion: s.scopeVersion + 1 }))
    useDocument.getState().startNew('new')
    forgetKeptParts()
    sceneRef.current?.frameAll()
    useStore.setState({ busy: false, statusText: 'New project.' })
    saved.markSaved(capture())
  }, () => settled || !saved.dirty() || deps.confirm('Start a new project? The changes in this one that are not saved are lost.'))

  return {
    capture,
    packProject: () => pack('host'),
    saveProject: () => pack('save'),
    saveProjectAs: () => pack('saveAs'),
    openProject,
    newProject,
  }
}

export type ProjectIo = ReturnType<typeof createProjectIo>
