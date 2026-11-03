// SPDX-License-Identifier: AGPL-3.0-only
// Create Sketch → Define interactive, as in QUICKSURFACE: click the start and
// the end of a section line on the part; the sketch plane stands upright
// (along Z) through that line. With "Automatically snap to X or Y direction"
// the line is held to whichever of X or Y it runs nearest.

import { create } from 'zustand'
import type { Vec3 } from '../../../src/core/types'
import type { PlaneRef } from '../core/features'

interface SectionLineState {
  /** Collecting the two clicks. */
  active: boolean
  /** The start, once clicked. */
  first: Vec3 | null
  snap: boolean
  /** Create Sketch → Through selection only: the cut kept only across the
   *  surface marked on the part. */
  throughSelection: boolean
  setThroughSelection: (on: boolean) => void
  /** Create Sketch → Outline Mesh: the part's outline through the plane
   *  (its shadow) instead of the cut, pieces under `outlineMinPoints` dropped. */
  outline: boolean
  outlineMinPoints: number
  setOutline: (on: boolean) => void
  setOutlineMinPoints: (n: number) => void
  start: () => void
  cancel: () => void
  setFirst: (p: Vec3) => void
  setSnap: (on: boolean) => void
}

export const useSectionLine = create<SectionLineState>((set) => ({
  active: false,
  first: null,
  snap: true,
  throughSelection: false,
  setThroughSelection: (throughSelection) => set({ throughSelection }),
  outline: false,
  outlineMinPoints: 5,
  setOutline: (outline) => set({ outline }),
  setOutlineMinPoints: (outlineMinPoints) => set({ outlineMinPoints }),
  start: () => set({ active: true, first: null }),
  cancel: () => set({ active: false, first: null }),
  setFirst: (first) => set({ first }),
  setSnap: (snap) => set({ snap }),
}))

/** The upright plane through the line from `a` to `b` (Z up), or null when
 *  the two clicks are one above the other and give no direction. Snapped, it
 *  is the coordinate plane the line runs along; otherwise a plane of its own. */
export function sectionLinePlane(a: Vec3, b: Vec3, snap: boolean): PlaneRef | null {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const l = Math.hypot(dx, dy)
  if (!(l > 1e-6)) return null
  if (snap) {
    // A line along X lies in a plane facing Y, and the other way about.
    return Math.abs(dx) >= Math.abs(dy) ? { kind: 'world', axis: 'y', offset: a[1] } : { kind: 'world', axis: 'x', offset: a[0] }
  }
  const u: Vec3 = [dx / l, dy / l, 0]
  // N × U = Z keeps the frame right-handed with V straight up.
  return { kind: 'fitted', label: 'Section line', frame: { origin: [a[0], a[1], a[2]], normal: [u[1], -u[0], 0], basisU: u, basisV: [0, 0, 1] } }
}
