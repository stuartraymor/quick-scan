// SPDX-License-Identifier: AGPL-3.0-only
// Analysis → Measure, as QUICKSURFACE 8.0.128 has it (recorded live): a
// dialog of four ways to measure on the mesh, the measurements laid over
// the view while it is open and gone when it closes; the way chosen is
// kept for the next time. A plugin may add ways of its own (PluginRuntime
// `measure`): a click it takes adds a readout here, a list of named
// results with the points they are measured between.

import { create } from 'zustand'
import type { Vec3 } from '../core/types'

/** The dialog's own ways, and a plugin's (`plugin:<id>`). */
export type MeasureMode = 'adaptive' | '3d' | 'extended' | 'point' | 'curve' | `plugin:${string}`

/** One named result of a readout. Lengths in millimetres, areas in square
 *  millimetres, angles in degrees; a point's coordinates in `point`. */
export interface MeasureRow {
  label: string
  value: number
  unit: 'length' | 'area' | 'deg' | 'point'
  point?: readonly number[]
  /** From the geometry's own definition; false for an estimate (a curve
   *  length integrated along samples). */
  exact: boolean
  note?: string
}

/** A plugin's measurement: what it is of, its results, and the points to
 *  draw it between. The points are the part's, unless `screen` places them
 *  — a plugin's own sheet laid over the view, say. */
export interface MeasureReadout {
  kind: 'readout'
  /** The plugin's handle on it. */
  tag?: string
  title: string
  rows: MeasureRow[]
  witness: Vec3[]
  /** The result boxed over the view beside the witness (an index into
   *  `rows`), after a short sign — R, Ø, ∠. */
  caption?: { row: number; sign: string }
  screen?: (p: Vec3) => { x: number; y: number } | null
}

/** What a plugin's way would take under the cursor, drawn before the
 *  click: the outline of the piece or the loop, the points a reading
 *  would stand between, and that reading — the second of a pair, say,
 *  before its click. Same placing as a readout's. */
export interface MeasurePreview {
  pointLabel?: string
  outline: Vec3[][]
  witness: Vec3[]
  row?: MeasureRow
  sign?: string
  screen?: (p: Vec3) => { x: number; y: number } | null
}

export type Measurement =
  | { kind: '3d' | 'extended'; a: Vec3; b: Vec3 }
  | { kind: 'point'; a: Vec3 }
  | MeasureReadout

interface MeasureToolState {
  open: boolean
  mode: MeasureMode
  items: Measurement[]
  /** The first point of a distance, picked and waiting for its second. */
  pending: Vec3 | null
  /** A plugin's way's preview under the cursor; null for none. */
  preview: MeasurePreview | null
  setPreview: (preview: MeasurePreview | null) => void
  setOpen: (open: boolean) => void
  setMode: (mode: MeasureMode) => void
  /** A point picked on the mesh, taken as the mode says. */
  pick: (p: Vec3) => Measurement | null
  /** A plugin's readout, added as it stands. */
  add: (m: MeasureReadout) => void
  deleteAll: () => void
  deleteLast: () => void
}

export const useMeasureTool = create<MeasureToolState>((set, get) => ({
  open: false,
  mode: 'adaptive',
  items: [],
  pending: null,
  preview: null,
  setPreview: (preview) => { if (preview !== null || get().preview !== null) set({ preview }) },
  // Closing takes every measurement away; opening starts on none.
  setOpen: (open) => set({ open, items: [], pending: null, preview: null }),
  setMode: (mode) => set({ mode, pending: null, preview: null }),
  pick: (p) => {
    const { mode, pending, items } = get()
    if (mode === 'point') {
      const m: Measurement = { kind: 'point', a: p }
      set({ items: [...items, m] })
      return m
    }
    if (mode !== 'adaptive' && mode !== '3d' && mode !== 'extended') return null
    if (!pending) {
      set({ pending: p })
      return null
    }
    const m: Measurement = { kind: mode === 'adaptive' ? 'extended' : mode, a: pending, b: p }
    set({ items: [...items, m], pending: null })
    return m
  },
  add: (m) => set((s) => ({ items: [...s.items, m] })),
  deleteAll: () => set({ items: [], pending: null, preview: null }),
  deleteLast: () => set((s) => (s.pending ? { pending: null } : { items: s.items.slice(0, -1) })),
}))

/** A distance and its parts along X, Y and Z, mm. */
export function measuredDistance(a: Vec3, b: Vec3): { d: number; dx: number; dy: number; dz: number } {
  const dx = Math.abs(b[0] - a[0]), dy = Math.abs(b[1] - a[1]), dz = Math.abs(b[2] - a[2])
  return { d: Math.hypot(dx, dy, dz), dx, dy, dz }
}

/** Copy gives the stored figures, not the display's: millimetres. */
const COPY_UNIT: Record<MeasureRow['unit'], string> = { length: 'mm', area: 'mm²', deg: '°', point: '' } // units-ok: Copy states the stored unit of the full-precision figure

/** A readout as Copy gives it: every result at full precision, one a line. */
export function readoutText(m: MeasureReadout): string {
  const row = (r: MeasureRow) => r.unit === 'point' && r.point
    ? `${r.label}: ${r.point.map((v, i) => `${'XYZ'[i]} ${v}`).join(' ')}`
    : `${r.label}: ${Number.isFinite(r.value) ? r.value : 'n/a'} ${COPY_UNIT[r.unit]}${r.exact ? '' : ' (estimated)'}${r.note ? ` — ${r.note}` : ''}`
  return [m.title, ...m.rows.map(row)].join('\n')
}
