// SPDX-License-Identifier: AGPL-3.0-only
// Create Sketch → Flip orientation: the sketch plane faces the other way, its
// frame still right-handed, and a second flip puts it back.

import { describe, expect, it } from 'vitest'
import { useReverse } from '../state/reStore'

describe('Create Sketch flip orientation', () => {
  it('reverses the normal, keeps the frame right-handed, and undoes itself', () => {
    expect(useReverse.getState().startSketchOn({ kind: 'world', axis: 'z', offset: 0 })).toBe(true)
    const before = useReverse.getState().sketchDraft!.frame
    useReverse.getState().flipSketchOrientation()
    const flipped = useReverse.getState().sketchDraft!.frame
    expect(flipped.normal.map((v, i) => v + before.normal[i]).every((v) => Math.abs(v) < 1e-12)).toBe(true)
    // V = N × U, unchanged by flipping both.
    const [n, u, v] = [flipped.normal, flipped.basisU, flipped.basisV]
    const nxu = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]]
    expect(nxu.every((c, i) => Math.abs(c - v[i]) < 1e-12)).toBe(true)
    useReverse.getState().flipSketchOrientation()
    const back = useReverse.getState().sketchDraft!.frame
    expect(back.normal.every((c, i) => Math.abs(c - before.normal[i]) < 1e-12)).toBe(true)
    expect(back.basisU.every((c, i) => Math.abs(c - before.basisU[i]) < 1e-12)).toBe(true)
    useReverse.getState().discardSketch()
  })
})
