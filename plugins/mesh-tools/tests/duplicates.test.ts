// SPDX-License-Identifier: AGPL-3.0-only
// Edit Scan's Duplicate triangles: a triangle on the same three places as an
// earlier one, either winding, on its own vertices or shared ones.
import { describe, expect, it } from 'vitest'
import { duplicateTriangles } from '../core/duplicates'
import { runMeshHotkey, meshHotkeys } from '../app/meshHotkeys'

describe('duplicate triangles', () => {
  it('finds a repeat by place, either way round, and leaves the first', () => {
    // Two triangles of a square, then the first again reversed on vertices
    // of its own, then a sliver folded to a line.
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0])
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3, 6, 5, 4, 0, 0, 1])
    const { mask, count } = duplicateTriangles(positions, indices, 7)
    expect(count).toBe(1)
    expect([...mask]).toEqual([0, 0, 1, 0])
  })

  it('finds none on a clean mesh', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0])
    expect(duplicateTriangles(positions, new Uint32Array([0, 1, 2, 0, 2, 3]), 4).count).toBe(0)
  })
})

describe('Edit Scan keys', () => {
  it('Ctrl + M smooths and Ctrl + D defeatures the selected area, only with something selected', () => {
    const ran: string[] = []
    meshHotkeys.smooth = () => ran.push('smooth')
    meshHotkeys.defeature = () => ran.push('defeature')
    const key = (k: string, ctrl = true) => ({ key: k, ctrlKey: ctrl, metaKey: false, altKey: false, shiftKey: false })
    expect(runMeshHotkey(key('m'), 10)).toBe(true)
    expect(runMeshHotkey(key('D'), 10)).toBe(true)
    expect(runMeshHotkey(key('d'), 0)).toBe(false)
    expect(runMeshHotkey(key('m', false), 10)).toBe(false)
    expect(ran).toEqual(['smooth', 'defeature'])
  })
})
