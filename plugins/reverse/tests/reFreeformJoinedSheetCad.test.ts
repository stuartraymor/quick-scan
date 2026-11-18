// SPDX-License-Identifier: AGPL-3.0-only
// A control surface with an irregular point made a CAD body: quads joined to
// a T (a quad welded by one whole side onto a 3 x 3 sheet, in the editor,
// 2026-11-18). At the two refinements the editor asks for, its four faces
// would not sew and stood 0.38 mm off the surface edited; it is now one
// sheet within a hundredth of a millimetre of it.
import { expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import type { Cage } from '../core/freeform/cage'
import { limitMesh } from '../core/freeform/limit'
import { freeformBody } from '../core/freeform/make'
import { ReKernel, type Shape } from '../core/kernel'

vi.setConfig({ testTimeout: 300_000 })
const kernelPromise = ReKernel.load()

const joined = {"positions":[-17.999998360566135,7.20191440662366e-7,17.017321195186867,-5.127557751271893,0.5083674210498452,19.087498799760375,-6.000001610494511,12.000001120474394,18.66859870896889,-17.999998360566135,12.000001120474394,17.031128539618237,5.9884041666527335,12.160743511300746,19.490155607014973,5.678008042872855,0.8382947784748503,20.227114560024273,17.76803535966923,11.746811253393721,18.392355299296607,13.530683300673093,-3.022799215600139,21.86248591648941,-10.14861632339378,-14.596041976508369,18.176059454773494,-18.001510706469407,-12.00006837591259,17.02732352651362,13.50150456493716,-8.860722237437397,20.63624656764942,11.311233059410249,-14.228836222630465,19.310112360079327,-6.099225469088787,-23.922733899332275,18.0077042491363,-17.844997926859442,-23.895545668459796,16.325553981496565,6.313979375429256,-23.12217103892075,16.654638310883097,17.368016641034004,-22.758768808110542,15.229723015941634,34.99999701948042,7.201914404061956e-7,12.855514029482038,34.99999701948042,-11.999999680091513,12.683189828292996],"faces":[[3,2,1,0],[1,2,4,5],[5,4,6,7],[0,1,8,9],[5,7,10,11],[9,8,12,13],[12,8,11,14],[14,11,10,15],[5,11,8,1],[7,16,17,10]],"creases":[]}
const cageOf = (raw: { positions: number[]; faces: number[][] }): Cage => ({ positions: Float64Array.from(raw.positions), faces: raw.faces, creases: [] })

/** The farthest the body's tessellation lies from the cage's limit surface, mm. */
function offLimit(k: ReKernel, cage: Cage, shape: Shape): number {
  const fine = limitMesh(cage, 5)
  const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(Array.from(fine.positions), 3))
  g.setIndex(fine.faces.flatMap((q) => [q[0], q[1], q[2], q[0], q[2], q[3]]))
  const bvh = new MeshBVH(g), p = new THREE.Vector3(), m = k.mesh(shape, .002, .05)
  let worst = 0
  for (let i = 0; i < m.positions.length; i += 3) worst = Math.max(worst, bvh.closestPointToPoint(p.set(m.positions[i], m.positions[i + 1], m.positions[i + 2]))!.distance)
  return worst
}

/** The length of the cage's own boundary on its limit surface, mm. */
function boundaryLength(cage: Cage): number {
  const fine = limitMesh(cage, 5), uses = new Map<string, number>()
  for (const f of fine.faces) f.forEach((a, i) => { const b = f[(i + 1) % f.length], key = a < b ? a + ':' + b : b + ':' + a; uses.set(key, (uses.get(key) ?? 0) + 1) })
  let length = 0
  for (const [key, n] of uses) if (n === 1) {
    const [a, b] = key.split(':').map(Number)
    length += Math.hypot(fine.positions[a * 3] - fine.positions[b * 3], fine.positions[a * 3 + 1] - fine.positions[b * 3 + 1], fine.positions[a * 3 + 2] - fine.positions[b * 3 + 2])
  }
  return length
}

it('makes quads joined to a T one sewn sheet on the edited surface', async () => {
  const k = await kernelPromise, cage = cageOf(joined)
  const made = freeformBody(k, cage, { steps: 2, snap: false })
  try {
    expect(made.report.valid).toBe(true)
    expect(made.report.quads).toBe(10)
    // Only the cage's own boundary is open: every seam between faces is shared.
    const open = k.openEdgeLength(made.shape, true), own = boundaryLength(cage)
    expect(open).toBeGreaterThan(own * .97)
    expect(open).toBeLessThan(own * 1.03 + .05)
    expect(offLimit(k, cage, made.shape)).toBeLessThan(.02)
  } finally { k.release(made.shape) }
})

it('keeps the refinement asked for where the cage is regular', async () => {
  const k = await kernelPromise
  const positions: number[] = [], faces: number[][] = []
  for (let j = 0; j <= 3; j++) for (let i = 0; i <= 3; i++) positions.push(i * 12, j * 12, 20 - ((i * 12 - 18) ** 2 + (j * 12 - 18) ** 2) / 200)
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) faces.push([j * 4 + i, j * 4 + i + 1, (j + 1) * 4 + i + 1, (j + 1) * 4 + i])
  const cage = cageOf({ positions, faces })
  const made = freeformBody(k, cage, { steps: 2, snap: false })
  try {
    expect(made.steps).toBe(2)
    expect(made.report.faces).toBe(1)
    expect(offLimit(k, cage, made.shape)).toBeLessThan(.02)
  } finally { k.release(made.shape) }
})

it('makes a notched 120-quad sheet in a few seconds', async () => {
  const k = await kernelPromise
  const n = 11, positions: number[] = [], faces: number[][] = []
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) positions.push(i * 6, j * 6, 20 - ((i * 6 - 33) ** 2 + (j * 6 - 33) ** 2) / 300)
  // The quad at one corner is left out: its inner corner is a notch.
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (i + j > 0) faces.push([j * (n + 1) + i, j * (n + 1) + i + 1, (j + 1) * (n + 1) + i + 1, (j + 1) * (n + 1) + i])
  const cage = cageOf({ positions: positions.slice(3), faces: faces.map((f) => f.map((v) => v - 1)) })
  const began = performance.now()
  const made = freeformBody(k, cage, { steps: 2, snap: false })
  const ms = performance.now() - began
  try {
    console.log('notched sheet', cage.faces.length, 'quads:', Math.round(ms), 'ms, steps', made.steps, 'faces', made.report.faces)
    expect(made.report.valid).toBe(true)
    const open = k.openEdgeLength(made.shape, true), own = boundaryLength(cage)
    expect(open).toBeLessThan(own * 1.03 + .05)
    expect(offLimit(k, cage, made.shape)).toBeLessThan(.02)
    expect(ms).toBeLessThan(20_000)
  } finally { k.release(made.shape) }
})