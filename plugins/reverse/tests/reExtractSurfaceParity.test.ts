// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { NominalSurface } from '../../../src/core/deviation/surface'
import { computeVertexNormals } from '../../../src/core/geometry/normals'
import { fitPlaneOnSelection } from '../../../src/core/fit/fitPlaneFromSeed'
import { fitSelectedCylinder } from '../../../src/core/fit/fitCylinderFromSeed'
import { dot } from '../../../src/core/vec'
import { Builder } from '../core/build'
import { ReKernel } from '../core/kernel'
import { decodeQsfMesh, readQsfContainer } from '../core/qsfContainer'
import { decodeQsfPlane } from '../core/qsfPlane'
import { decodeQsfPrimitive } from '../core/qsfPrimitive'
import { extractedSurface } from '../core/extractedSurface'
import { INTERACTIVE_SURFACE_FIT } from '../core/surfaceFit'
import { build } from './reKit'

const fixtures = process.env.QUICKSCAN_NATIVE_PRIMITIVE_FIXTURES
it.skipIf(!fixtures).each(['plane', 'cylinder'] as const)('compares the extracted %s and its trimmed CAD carrier with the saved QUICKSURFACE fit', async shape => {
  const records = readQsfContainer(readFileSync(join(fixtures!, 'dense-' + shape + '.qsf'))).records
  const data = (type: number) => records.find(r => r.type === type)!.bytes
  const mesh = decodeQsfMesh(data(4))
  const native = shape === 'plane' ? decodeQsfPlane(data(8)) : decodeQsfPrimitive(10, data(10))
  const marks: number[] = []
  const pos = mesh.positions
  for (let i = 0; i < pos.length; i += 3) {
    // Reconstruct the top cap or full round wall on this axis-aligned calibration mesh.
    const distance = 'normal' in native ? Math.abs(pos[i+2]-native.origin[2])
      : native.kind === 'cylinder' ? Math.abs(Math.hypot(pos[i],pos[i+1])-native.radius) : Infinity
    if (distance < 0.001) marks.push(i/3)
  }
  const ids = Uint32Array.from(marks), normals = computeVertexNormals(pos, mesh.triangles)
  const graph = { positions: pos, normals }
  const measured = shape === 'plane' ? fitPlaneOnSelection(graph, ids, { sigma: 0 }) : fitSelectedCylinder(graph, ids, 0)
  const surface = extractedSurface(shape, pos, normals, ids, [], { mode: 'free' })
  expect(surface.held).toEqual(measured)
  const b = new Builder(await ReKernel.load())
  try {
    b.setScan(new NominalSurface(pos,mesh.triangles),pos,normals)
    const out = await build(b,[{ id:1, kind:'surface', name:'Parity', region:ids, fit:{...INTERACTIVE_SURFACE_FIT, expandPct:0}, shape, constrain:{ mode:'free' }, visible:true }])
    expect(out.results[0].message ?? out.results[0].status).toBe('ok')
    const report = out.results[0].surface!
    expect(report.rms).toBe(measured.sigma)
    const face = out.bodies[0].topology.faces[0].fingerprint
    expect(face.kind).toBe(shape)
    if (measured.kind === 'plane' && 'normal' in native) {
      expect(Math.abs(dot(measured.normal, native.normal))).toBeCloseTo(1,8)
      expect(Math.abs(dot(measured.center,native.normal)-dot(native.origin,native.normal))).toBeLessThan(0.0001)
    } else if (measured.kind === 'cylinder' && 'kind' in native && native.kind === 'cylinder') {
      expect(Math.abs(dot(measured.axis,native.axis))).toBeCloseTo(1,8)
      expect(Math.hypot(measured.center[0]-native.start[0],measured.center[1]-native.start[1])).toBeLessThan(0.0001)
      expect(report.radius).toBe(measured.radius)
      expect(Math.abs(measured.radius-native.radius)).toBeLessThan(0.0001)
    } else throw Error('Fixture does not hold the expected primitive')
    console.log('NATIVE_PRIMITIVE',JSON.stringify({shape,points:ids.length,native: 'normal' in native ? {normal:native.normal,origin:native.origin,display:native.nativeDisplaySize} : native, nativeRms:native.fitRms, quickScanRms:report.rms, radius:report.radius, face}))
  } finally { b.dispose() }
})
