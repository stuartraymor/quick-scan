// SPDX-License-Identifier: AGPL-3.0-only
// Project the mesh boundaries on OXY plane: a wall from every rim edge down
// to Z = 0, wound with the surface, as QUICKSURFACE 8.0.128 builds it.
import { describe, expect, it } from 'vitest'
import { skirtToOxy } from '../core/skirt'

/** Every edge walked once each way — a consistently wound surface. */
function directed(indices: Uint32Array): Map<string, number> {
  const m = new Map<string, number>()
  for (let t = 0; t < indices.length; t += 3) for (let k = 0; k < 3; k++) {
    const key = `${indices[t + k]}>${indices[t + ((k + 1) % 3)]}`
    m.set(key, (m.get(key) ?? 0) + 1)
  }
  return m
}

describe('Project the mesh boundaries on OXY plane', () => {
  it('hangs a wall from each rim edge of a plate at Z = 5 down to Z = 0', () => {
    const positions = new Float32Array([0, 0, 5, 10, 0, 5, 10, 10, 5, 0, 10, 5])
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3])
    const r = skirtToOxy(positions, indices, 4)
    expect(r.edges).toBe(4)
    expect(r.positions.length / 3).toBe(8)
    expect(r.indices.length / 3).toBe(2 + 8)
    for (let v = 4; v < 8; v++) expect(r.positions[v * 3 + 2]).toBe(0)
    // The plate's own corners are where they were.
    expect([...r.positions.subarray(0, 12)]).toEqual([...positions])
    const d = directed(r.indices)
    for (const [key, n] of d) {
      expect(n).toBe(1)
      const [a, b] = key.split('>')
      // Every edge but the wall's foot is met the other way round as well.
      if (Number(a) < 4 || Number(b) < 4) expect(d.has(`${b}>${a}`), key).toBe(true)
    }
  })

  it('leaves a closed mesh, and a rim already on Z = 0, as they are', () => {
    const tetra = skirtToOxy(new Float32Array([0, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 2]), new Uint32Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3]), 4)
    expect(tetra.edges).toBe(0)
    const floor = skirtToOxy(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Uint32Array([0, 1, 2]), 3)
    expect(floor.edges).toBe(0)
  })
})

import { remapVertices } from '../core/remapVertices'
import { useMeshTools } from '../state/meshStore'

describe('Save selection status', () => {
  it('keeps named selections, updates one to current under its name, renames and deletes', () => {
    const m = () => useMeshTools.getState()
    m().putSelectionStatus('Sel1', new Uint32Array([1, 2]))
    m().putSelectionStatus('Sel2', new Uint32Array([3]))
    m().putSelectionStatus('Sel1', new Uint32Array([4, 5, 6]))
    expect(m().selectionStatuses.map((x) => [x.name, x.vertices.length])).toEqual([['Sel1', 3], ['Sel2', 1]])
    m().renameSelectionStatus('Sel2', 'Sel1')
    expect(m().selectionStatuses[1].name).toBe('Sel2')
    m().renameSelectionStatus('Sel2', 'Top face')
    m().deleteSelectionStatus('Sel1')
    expect(m().selectionStatuses.map((x) => x.name)).toEqual(['Top face'])
    m().clear()
    expect(m().selectionStatuses).toEqual([])
  })

  it('follows its points through an edit, dropping those that went', () => {
    expect([...remapVertices(new Uint32Array([0, 2, 3]), new Int32Array([0, -1, 1, 2]))]).toEqual([0, 1, 2])
  })
})
