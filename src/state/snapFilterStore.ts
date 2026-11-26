// SPDX-License-Identifier: AGPL-3.0-only
// What a click may land on: the snap bar at the bottom of the graphics
// window. One set of switches per kind of work, because the same point is
// wanted in one and in the way in the other — the middle of a line is a
// good place to start a new line from, and a bad thing to take when the
// line itself is clicked for its length:
//   draw    — where a drawn or dragged point snaps, and what Edit Sketch tools pick;
//   pick    — what a tool that takes existing geometry picks outside Edit Sketch;
//   measure — what Analysis → Measure takes on the scan.
// The tool in hand says which set the bar shows (`context`); with none the
// bar is not shown. Remembered on this computer.

import { create } from 'zustand'

export type SnapKey = 'endpoint' | 'midpoint' | 'center' | 'quadrant' | 'curve' | 'scan'
export type SnapFlags = Record<SnapKey, boolean>
/** The switches as a tool reads them: with All on, every kind is on and
 *  `nearest` says to take whichever point is closest to the cursor rather
 *  than by rank. */
export type SnapRead = SnapFlags & { nearest: boolean }
export type SnapContextName = 'draw' | 'pick' | 'measure'
type SnapBarContext = SnapContextName | 'sketchPick'

/** Sketch geometry pickers offer compatible targets from the drawing preferences. */
export const snapProfile = (context: SnapBarContext): SnapContextName => context === 'sketchPick' ? 'draw' : context

/** The switches each context offers, in the order the bar shows them, with
 *  the words on each. */
export const SNAP_KEYS: Record<SnapContextName, { key: SnapKey; label: string; tip: string }[]> = {
  draw: [
    { key: 'endpoint', label: 'End', tip: 'Endpoints: the ends of lines, arcs and splines, and points' },
    { key: 'midpoint', label: 'Mid', tip: 'Midpoints: the middle of a line' },
    { key: 'center', label: 'Centre', tip: 'Centres of circles and arcs' },
    { key: 'quadrant', label: 'Quad', tip: 'Quadrants: the 0°, 90°, 180° and 270° points of circles and arcs' },
    { key: 'curve', label: 'Curve', tip: 'On a curve: anywhere along a line, arc, circle or spline' },
    { key: 'scan', label: 'Scan', tip: 'Scan points: the points of the section cut from the scan' },
  ],
  pick: [
    { key: 'endpoint', label: 'End', tip: 'Endpoints: the ends of lines, arcs and splines, and points' },
    { key: 'midpoint', label: 'Mid', tip: 'Midpoints: the middle of a line, taken as a point' },
    { key: 'center', label: 'Centre', tip: 'Centres of circles and arcs, taken as a point' },
    { key: 'quadrant', label: 'Quad', tip: 'Quadrants: the 0°, 90°, 180° and 270° points of circles and arcs' },
    { key: 'curve', label: 'Curve', tip: 'Whole pieces: a line, arc, circle or spline clicked along its length' },
  ],
  measure: [
    { key: 'endpoint', label: 'Vertex', tip: 'Mesh vertices: the corner of the triangle nearest the click (also: hold Ctrl)' },
    { key: 'curve', label: 'Surface', tip: 'Anywhere on the surface, exactly where the click lands' },
  ],
}

export const DEFAULT_SNAP_FLAGS: Record<SnapContextName, SnapFlags> = {
  draw: { endpoint: true, midpoint: true, center: true, quadrant: true, curve: true, scan: true },
  // Every point starts on, each with its square on the sheet: a middle or a
  // quadrant point is taken by clicking its square, and the line or the
  // circle by clicking anywhere else along it.
  pick: { endpoint: true, midpoint: true, center: true, quadrant: true, curve: true, scan: true },
  measure: { endpoint: false, midpoint: false, center: false, quadrant: false, curve: true, scan: true },
}

/** Whether All starts on. Drawing: yes — every snap live and the closest
 *  taken is what a hand expects of a sketcher. Picking: no — with it on a
 *  line clicked at its middle is its midpoint, not the line whose length
 *  was wanted; one press switches it on. */
export const DEFAULT_SNAP_ALL: Record<SnapContextName, boolean> = { draw: true, pick: false, measure: false }

const KEY = 'scanruler.snapfilter'
const CONTEXTS: SnapContextName[] = ['draw', 'pick', 'measure']
const KEYS: SnapKey[] = ['endpoint', 'midpoint', 'center', 'quadrant', 'curve', 'scan']

function storedAll(): Record<SnapContextName, boolean> {
  const out: Record<SnapContextName, boolean> = { ...DEFAULT_SNAP_ALL }
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { all?: Record<string, unknown> } | null
    for (const c of CONTEXTS) if (typeof raw?.all?.[c] === 'boolean') out[c] = raw.all[c] as boolean
  } catch {
    // Unreadable storage: off.
  }
  return out
}

function stored(): Record<SnapContextName, SnapFlags> {
  const out = structuredClone(DEFAULT_SNAP_FLAGS)
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Record<string, Record<string, unknown>> | null
    if (raw && typeof raw === 'object') for (const c of CONTEXTS) for (const k of KEYS) if (typeof raw[c]?.[k] === 'boolean') out[c][k] = raw[c][k] as boolean
  } catch {
    // Unreadable storage: the defaults.
  }
  return out
}

interface SnapFilterState {
  flags: Record<SnapContextName, SnapFlags>
  /** All — the smart snap: every kind at once, the closest to the cursor
   *  taken. While it is on the single switches stand as they were left. */
  all: Record<SnapContextName, boolean>
  setAll: (context: SnapContextName, on: boolean) => void
  /** The set the tool in hand uses, or null when no tool snaps. */
  context: SnapBarContext | null
  setContext: (context: SnapBarContext | null) => void
  toggle: (context: SnapContextName, key: SnapKey) => void
  set: (context: SnapContextName, key: SnapKey, on: boolean) => void
  reset: (context: SnapContextName) => void
}

const keep = (flags: Record<SnapContextName, SnapFlags>, all: Record<SnapContextName, boolean>) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...flags, all }))
  } catch {
    // Not kept: it still holds for this run.
  }
}

export const useSnapFilter = create<SnapFilterState>((set, get) => ({
  flags: typeof localStorage === 'undefined' ? structuredClone(DEFAULT_SNAP_FLAGS) : stored(),
  all: typeof localStorage === 'undefined' ? { ...DEFAULT_SNAP_ALL } : storedAll(),
  setAll: (context, on) => {
    const all = { ...get().all, [context]: on }
    keep(get().flags, all)
    set({ all })
  },
  context: null,
  setContext: (context) => { if (get().context !== context) set({ context }) },
  toggle: (context, key) => get().set(context, key, !get().flags[context][key]),
  set: (context, key, on) => {
    // A single switch pressed while All is on takes over from All.
    const flags = { ...get().flags, [context]: { ...get().flags[context], [key]: on } }
    const all = { ...get().all, [context]: false }
    keep(flags, all)
    set({ flags, all })
  },
  reset: (context) => {
    const flags = { ...get().flags, [context]: { ...DEFAULT_SNAP_FLAGS[context] } }
    const all = { ...get().all, [context]: DEFAULT_SNAP_ALL[context] }
    keep(flags, all)
    set({ flags, all })
  },
}))

/** The switches of a context as they stand. */
export const snapFlags = (tool: SnapBarContext): SnapRead => {
  const context = snapProfile(tool)
  const s = useSnapFilter.getState()
  return s.all[context]
    ? { endpoint: true, midpoint: true, center: true, quadrant: true, curve: true, scan: true, nearest: true }
    : { ...s.flags[context], nearest: false }
}
