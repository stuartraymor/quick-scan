// SPDX-License-Identifier: AGPL-3.0-only
// Parent/child reading of the document browser's History entries. Each entry
// names the document-order keys it is built on; everything here is derived
// from those lists, so core and plugin recipes answer the same way.

export interface DependencyEntry { key: string; label?: string; parents?: readonly string[] }

/** Entries built directly on `key`, in the order given. */
export function childrenOf(key: string, entries: readonly DependencyEntry[]): DependencyEntry[] {
  return entries.filter((entry) => entry.key !== key && (entry.parents ?? []).includes(key))
}

/** The asked keys and everything built on them, directly or through others,
 *  in the entries' (document) order. Keys the entries do not know are kept
 *  at the end so a caller still sees what it asked for. */
export function dependencyCascade(keys: readonly string[], entries: readonly DependencyEntry[]): string[] {
  const out = new Set<string>(keys)
  let grew = true
  while (grew) {
    grew = false
    for (const entry of entries) {
      if (out.has(entry.key)) continue
      if ((entry.parents ?? []).some((parent) => out.has(parent))) { out.add(entry.key); grew = true }
    }
  }
  const known = entries.map((entry) => entry.key).filter((key) => out.has(key))
  return [...known, ...[...out].filter((key) => !known.includes(key))]
}

/** What the dependency card says for one entry: its parents (`<--`) and
 *  the entries built on it (`-->`), by label. Missing parents read as
 *  "Unavailable reference", which is how a broken link shows. */
export function dependencyCard(key: string, entries: readonly DependencyEntry[]): { label: string; parents: string[]; children: string[] } | null {
  const entry = entries.find((item) => item.key === key)
  if (!entry) return null
  const label = (k: string) => entries.find((item) => item.key === k)?.label ?? 'Unavailable reference'
  return {
    label: entry.label ?? key,
    parents: [...new Set(entry.parents ?? [])].filter((parent) => parent !== key).map(label),
    children: childrenOf(key, entries).map((child) => child.label ?? child.key),
  }
}

/** QUICKSURFACE's Parent/Child view over the History entries: each entry
 *  holds the inputs it was built from (Extruded(1) ▸ Sketch(1)), and the
 *  top level is what nothing later uses. An input used by several later
 *  entries sits under the first of them; `consumersOf` lists them all, for
 *  the tooltip. Only later entries take an input, so a cycle cannot form
 *  and every entry shows exactly once. */
export function historyTree<E extends DependencyEntry>(entries: readonly E[]): { roots: E[]; children: Map<string, E[]>; consumersOf: Map<string, string[]> } {
  const at = new Map(entries.map((entry, index) => [entry.key, index]))
  const consumersOf = new Map<string, string[]>()
  for (const entry of entries) {
    for (const parent of new Set(entry.parents ?? [])) {
      if (parent === entry.key || (at.get(parent) ?? Infinity) >= at.get(entry.key)!) continue
      consumersOf.set(parent, [...(consumersOf.get(parent) ?? []), entry.key])
    }
  }
  const children = new Map<string, E[]>()
  const roots: E[] = []
  for (const entry of entries) {
    const holder = consumersOf.get(entry.key)?.[0]
    if (holder === undefined) roots.push(entry)
    else children.set(holder, [...(children.get(holder) ?? []), entry])
  }
  return { roots, children, consumersOf }
}
