// SPDX-License-Identifier: AGPL-3.0-only
// The straight extrude's live map while its arrows are dragged (1.2.13):
// read in closed form against the profiles (core/prismMap) on every frame
// of a drag, it has to say what the kernel's map of the built ghost says
// — the ghost here a prism meshed face by face, as the kernel meshes, its
// seams joined so a point beside a wall under the rim of the face above it
// reads outside. Then how the map is drawn (core/mapDisplay): the noise on
// a flat face averaged out, a real step kept; and the arrows' end faces
// they slide within to stay in view when zoomed in (preview.extrudeGrips).
import { describe, expect, it } from 'vitest'
import { NominalSurface, seamVertices } from '../../../src/core/deviation/surface'
import type { KernelMesh } from '../core/kernel'
import { DEFAULT_FACING_DEG, liveMap, surfaceOfMeshes } from '../core/liveMap'
import { displayValues, DISPLAY_STEP_SHARE, vertexNeighbours } from '../core/mapDisplay'
import { extrudeField, prepareExtrudeMap, prismEnds, prismReadable, type PrismLoops } from '../core/prismMap'
import { extrudeGrips } from '../core/preview'
import { findRegions } from '../core/regions'
import { addRectangle, emptySketch } from '../core/sketch'
import type { Vec2 } from '../../../src/core/flat/types'
import { XY } from './reKit'

type V3 = [number, number, number]

/** An axis box as the kernel meshes a body: face by face, each face its
 *  own grid of vertices, wound outward — so a vertex on an edge is there
 *  once per face that meets there. */
function faceByFaceBox(min: V3, max: V3, grid = 3): KernelMesh {
  const [x0, y0, z0] = min
  const [x1, y1, z1] = max
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0
  // Origin and the two edges of each face, cross(u, v) pointing out.
  const faces: [V3, V3, V3][] = [
    [[x0, y0, z1], [dx, 0, 0], [0, dy, 0]],
    [[x0, y0, z0], [0, dy, 0], [dx, 0, 0]],
    [[x1, y0, z0], [0, dy, 0], [0, 0, dz]],
    [[x0, y0, z0], [0, 0, dz], [0, dy, 0]],
    [[x0, y1, z0], [0, 0, dz], [dx, 0, 0]],
    [[x0, y0, z0], [dx, 0, 0], [0, 0, dz]],
  ]
  const positions: number[] = []
  const indices: number[] = []
  for (const [o, u, v] of faces) {
    const base = positions.length / 3
    for (let j = 0; j <= grid; j++) {
      for (let i = 0; i <= grid; i++) {
        const s = i / grid, t = j / grid
        positions.push(o[0] + u[0] * s + v[0] * t, o[1] + u[1] * s + v[1] * t, o[2] + u[2] * s + v[2] * t)
      }
    }
    const at = (i: number, j: number) => base + j * (grid + 1) + i
    for (let j = 0; j < grid; j++) {
      for (let i = 0; i < grid; i++) {
        indices.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1))
      }
    }
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices), normals: new Float32Array(positions.length) }
}

const unit = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2])
  return [v[0] / l, v[1] / l, v[2] / l]
}

/** The profile: x −6..6, y −4..4 on the XY plane, extruded 0..5. */
const RECT: Vec2[] = [[-6, -4], [6, -4], [6, 4], [-6, 4]]
const LOOPS: PrismLoops[] = [{ outer: RECT, holes: [] }]
const PRISM = faceByFaceBox([-6, -4, 0], [6, 4, 5])
const RANGE = 0.1

/** A scan of a plate the profile sits on, and of the walls it would cut:
 *  each point with its normal and, where it is known, what it reads. */
const POINTS: { at: V3; n: V3; reads?: number }[] = [
  // The top face, over the profile: a hair under and over it.
  { at: [0, 0, 4.96], n: [0, 0, 1], reads: -0.04 },
  { at: [-3, 2, 5.03], n: [0, 0, 1], reads: 0.03 },
  { at: [4, -3, 4.98], n: [0, 0, 1], reads: -0.02 },
  // The plate beyond the wall, just under the top's height: outside by
  // its distance across — signed by the edge it is nearest, not the face
  // over it (the seams joined).
  { at: [6.3, 0.5, 4.98], n: [0, 0, 1], reads: 0.3 },
  { at: [-6.5, 2, 4.97], n: [0, 0, 1], reads: 0.5 },
  { at: [2, 4.6, 4.99], n: [0, 0, 1], reads: 0.6 },
  { at: [6.8, -1, 5.01], n: [0, 0, 1] },
  // The side wall, on and in.
  { at: [6.04, 1, 2.5], n: [1, 0, 0], reads: 0.04 },
  { at: [5.95, -1, 2], n: [1, 0, 0], reads: -0.05 },
  // Under the top, its normal leaning away from the wall it is nearest:
  // read against the top that faces it, not the wall behind it.
  { at: [5.99, 0.5, 4.95], n: unit([-0.2, 0, 0.98]), reads: -0.05 },
  // Under the bottom.
  { at: [1, 1, -0.05], n: [0, 0, -1], reads: 0.05 },
  // Out of reach: not read.
  { at: [0, 0, 9], n: [0, 0, 1] },
  { at: [20, 0, 2], n: [1, 0, 0] },
]

function scanOf(points: { at: V3; n: V3 }[]): { positions: Float32Array; normals: Float32Array } {
  const positions = new Float32Array(points.length * 3)
  const normals = new Float32Array(points.length * 3)
  points.forEach((p, i) => {
    positions.set(p.at, i * 3)
    normals.set(p.n, i * 3)
  })
  return { positions, normals }
}

function asMap(field: { subset: Uint32Array; values: Float32Array }): Map<number, number> {
  return new Map([...field.subset].map((v, i) => [v, field.values[i]]))
}

describe('the straight extrude’s map in closed form', () => {
  const { positions, normals } = scanOf(POINTS)
  const prep = prepareExtrudeMap(positions, normals, XY, LOOPS, RANGE)

  it('reads what the kernel’s map of the same prism reads, vertex for vertex', () => {
    const closed = asMap(extrudeField(prep, 0, 5))
    const kernel = asMap(liveMap(surfaceOfMeshes([PRISM])!, positions, null, RANGE, false, { normals, facingDeg: DEFAULT_FACING_DEG }))
    expect([...closed.keys()]).toEqual([...kernel.keys()])
    // Within a micron: beside a wall at the top's height the kernel may take
    // the top's edge where the closed form keeps the wall — hypot(d, a
    // hair) against d.
    for (const [v, d] of kernel) expect(Math.abs(closed.get(v)! - d), `point ${v}`).toBeLessThan(1e-3)
    POINTS.forEach((p, v) => {
      if (p.reads !== undefined) expect(Math.abs(closed.get(v)! - p.reads), `point ${v}`).toBeLessThan(1e-3)
    })
    expect(closed.has(11)).toBe(false)
    expect(closed.has(12)).toBe(false)
  })

  it('needs the kernel mesh’s seams joined: unjoined, the plate beside the wall reads inside', () => {
    const unjoined = asMap(liveMap(surfaceOfMeshes([PRISM], { joinSeams: false })!, positions, null, RANGE, false, { normals, facingDeg: DEFAULT_FACING_DEG }))
    expect(unjoined.get(3)!).toBeLessThan(0)
    const joined = asMap(liveMap(surfaceOfMeshes([PRISM])!, positions, null, RANGE, false, { normals, facingDeg: DEFAULT_FACING_DEG }))
    expect(Math.abs(joined.get(3)! - 0.3)).toBeLessThan(1e-3)
  })

  it('reads either end order, and a symmetric extent about the plane', () => {
    expect(asMap(extrudeField(prep, 5, 0))).toEqual(asMap(extrudeField(prep, 0, 5)))
    expect(prismEnds({ kind: 'symmetric', total: 10 })).toEqual([-5, 5])
    expect(prismEnds({ kind: 'distance', from: -2, to: 3 })).toEqual([-2, 3])
  })

  it('takes a vertex whose nearest face turns away to the face that faces it — and, told not to, the nearest', () => {
    const faced = asMap(extrudeField(prep, 0, 5, true))
    const plain = asMap(extrudeField(prep, 0, 5, false))
    expect(faced.get(9)!).toBeCloseTo(-0.05, 4)
    expect(plain.get(9)!).toBeCloseTo(-0.01, 4)
  })

  it('reads two profiles that share a side as one outline: the side between them is inside the body', () => {
    const halves: PrismLoops[] = [
      { outer: [[-6, -4], [0, -4], [0, 4], [-6, 4]], holes: [] },
      { outer: [[0, -4], [6, -4], [6, 4], [0, 4]], holes: [] },
    ]
    const seam = scanOf([{ at: [0.02, 0, 4.97], n: [0, 0, 1] }, { at: [-0.01, 1, 5.02], n: [0, 0, 1] }, ...POINTS])
    const one = asMap(extrudeField(prepareExtrudeMap(seam.positions, seam.normals, XY, LOOPS, RANGE), 0, 5))
    const two = asMap(extrudeField(prepareExtrudeMap(seam.positions, seam.normals, XY, halves, RANGE), 0, 5))
    expect([...two.keys()]).toEqual([...one.keys()])
    for (const [v, d] of one) expect(two.get(v)!).toBeCloseTo(d, 6)
    expect(two.get(0)!).toBeCloseTo(-0.03, 4)
    expect(two.get(1)!).toBeCloseTo(0.02, 4)
  })

  it('is read only for a ghost it reads exactly: square to the sketch, untapered, both ends numbers', () => {
    const base = { draftDeg: 0, extent: { kind: 'distance' } }
    expect(prismReadable(base)).toBe(true)
    expect(prismReadable({ ...base, extent: { kind: 'symmetric' } })).toBe(true)
    expect(prismReadable({ ...base, draftDeg: 2 })).toBe(false)
    expect(prismReadable({ ...base, direction: [0, 0.6, 0.8] })).toBe(false)
    expect(prismReadable({ ...base, face: { body: 1 } })).toBe(false)
    expect(prismReadable({ ...base, extent: { kind: 'toFace' } })).toBe(false)
  })
})

describe('the seams of a mesh meshed face by face', () => {
  it('stand each vertex for the first at its place, within a millionth of the mesh', () => {
    const p = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1e-8, 0, 2, 0, 0, 1.001, 0, 0])
    expect([...seamVertices(p, 3)]).toEqual([0, 1, 0, 1, 4, 5])
  })

  it('give the box the pseudonormal of its edge where two faces meet', () => {
    const joined = new NominalSurface(PRISM.positions, PRISM.indices, { joinSeams: true })
    const hit = { distance: 0, signed: 0, px: 0, py: 0, pz: 0, nx: 0, ny: 0, nz: 0, faceIndex: 0 }
    // Diagonally off the top edge at x = 6: the edge's normal, between the
    // top's and the wall's.
    expect(joined.closest(7, 0, 6, hit)).toBe(true)
    expect(hit.nx).toBeCloseTo(Math.SQRT1_2, 5)
    expect(hit.nz).toBeCloseTo(Math.SQRT1_2, 5)
    expect(hit.signed).toBeCloseTo(Math.SQRT2, 5)
  })
})

describe('the map as drawn', () => {
  /** A strip of a flat face 40 × 10 vertices, 0.1 mm apart, its two
   *  triangles a square. */
  function strip(nx = 40, ny = 10): { indices: Uint32Array; count: number } {
    const indices: number[] = []
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i
        indices.push(a, a + 1, a + nx + 1, a, a + nx + 1, a + nx)
      }
    }
    return { indices: Uint32Array.from(indices), count: nx * ny }
  }

  it('averages the noise out of a face read within the range, and keeps a step as sharp as it was read', () => {
    const { indices, count } = strip()
    const adj = vertexNeighbours(indices, count)
    // Left of x = 20: a face 0.01 off with ±0.006 of noise; right: 0.08 off.
    const subset = new Uint32Array(count)
    const values = new Float32Array(count)
    for (let v = 0; v < count; v++) {
      const i = v % 40
      subset[v] = v
      values[v] = (i < 20 ? 0.01 : 0.08) + (((v * 7919) % 13) / 12 - 0.5) * 0.012
    }
    const slot = new Int32Array(count).fill(-1)
    const shown = displayValues({ subset, values }, adj, RANGE, slot)
    const spread = (a: Float32Array, side: (i: number) => boolean) => {
      const xs = [...a].filter((_, v) => side(v % 40))
      const mean = xs.reduce((s, x) => s + x, 0) / xs.length
      return { mean, sd: Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length) }
    }
    const left = (i: number) => i < 19
    const right = (i: number) => i > 20
    expect(spread(shown, left).sd).toBeLessThan(spread(values, left).sd / 2)
    expect(spread(shown, right).sd).toBeLessThan(spread(values, right).sd / 2)
    expect(spread(shown, left).mean).toBeCloseTo(spread(values, left).mean, 3)
    // The step: every vertex either side still on its own side of it.
    for (let v = 0; v < count; v++) {
      if (v % 40 < 20) expect(shown[v]).toBeLessThan(0.03)
      else expect(shown[v]).toBeGreaterThan(0.06)
    }
    // The figures are the readings' own; the scratch is handed back clean.
    expect(values[0]).toBeCloseTo(0.01 + (0 / 12 - 0.5) * 0.012, 6)
    expect(slot.every((s) => s === -1)).toBe(true)
    expect(DISPLAY_STEP_SHARE * RANGE).toBeLessThan(0.07)
  })

  it('draws a reading with no neighbour read as read', () => {
    const { indices, count } = strip(4, 4)
    const adj = vertexNeighbours(indices, count)
    const shown = displayValues({ subset: Uint32Array.from([0, 15]), values: Float32Array.from([0.02, -0.03]) }, adj, RANGE, new Int32Array(count).fill(-1))
    expect([...shown].map((x) => +x.toFixed(6))).toEqual([0.02, -0.03])
  })
})

describe('the extrude arrows’ end faces', () => {
  const sketch = emptySketch()
  addRectangle(sketch, [0, 0], [40, 20])
  const regions = findRegions(sketch)

  it('stand each arrow on the profile lifted to its end’s height, to slide within when zoomed in', () => {
    const [from, to] = extrudeGrips(XY, regions, { kind: 'distance', from: -2, to: 10 })
    for (const [grip, z] of [[from, -2], [to, 10]] as const) {
      expect(grip.face).toBeDefined()
      const pts = grip.face!.flat()
      expect(pts.every((p) => Math.abs(p[2] - z) < 1e-9)).toBe(true)
      expect(Math.min(...pts.map((p) => p[0]))).toBeCloseTo(0, 9)
      expect(Math.max(...pts.map((p) => p[0]))).toBeCloseTo(40, 9)
      expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo(20, 9)
    }
    // The arrows themselves where they were: the drag is the same wherever
    // one is drawn.
    expect(to.position).toEqual([20, 10, 10])
  })

  it('gives none to arrows swept askew, whose ends lean off them', () => {
    const grips = extrudeGrips(XY, regions, { kind: 'distance', from: 0, to: 10 }, [0, 0.6, 0.8])
    expect(grips.every((g) => g.face === undefined)).toBe(true)
  })
})
