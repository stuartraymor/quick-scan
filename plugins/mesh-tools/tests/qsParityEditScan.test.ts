// SPDX-License-Identifier: AGPL-3.0-only
// Edit Scan opens on the mesh's quality, as QUICKSURFACE's does: individual
// meshes, holes, boundaries — each with the tool that mends it.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { healthOf, MeshHealthView } from '../ui/MeshHealth'

describe('Edit Scan mesh quality — QUICKSURFACE parity', () => {
  it('reads the counts out of mesh.inspect', () => {
    expect(healthOf({ islands: { pieces: 5 }, holes: { holes: 17, rims: 19 }, bad: 2, duplicates: 6 })).toEqual({ meshes: 5, holes: 17, boundaries: 19, nonManifold: 2, duplicates: 6 })
    expect(healthOf(null)).toBeNull()
  })

  it('lists Individual meshes, Holes and Boundaries with an Edit button each', () => {
    const html = renderToStaticMarkup(createElement(MeshHealthView, { health: { meshes: 5, holes: 17, boundaries: 19, nonManifold: 0 }, busy: false, onTool: () => {} }))
    const rows = [...html.matchAll(/data-test="mesh-health-([a-z]+)"/g)].map((m) => m[1])
    // QUICKSURFACE 8.0.128 (2026-11-03): Duplicate triangles with Remove
    // under Boundaries; the shared-edge count is Quick Scan's own extra.
    expect(rows).toEqual(['meshes', 'holes', 'boundaries', 'duplicates', 'nonmanifold'])
    expect(html).toContain('Individual meshes')
    expect((html.match(/Edit …/g) ?? []).length).toBe(3)
    expect(html).toMatch(/mesh-health-warn">5</)
  })

  it('greys the Edit button when there is nothing to mend', () => {
    const html = renderToStaticMarkup(createElement(MeshHealthView, { health: { meshes: 1, holes: 0, boundaries: 0, nonManifold: 0 }, busy: false, onTool: () => {} }))
    expect((html.match(/<button disabled=""/g) ?? []).length).toBe(2)
  })
})
