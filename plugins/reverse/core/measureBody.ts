// SPDX-License-Identifier: AGPL-3.0-only
import type { AnalyticGeometry } from '../../../src/core/measure/analytic'
import type { Vec3 } from '../../../src/core/types'
import type { MeasureReadout, MeasureRow } from '../../../src/state/measureToolStore'
import type { BodyMeasureHit } from '../viewer/bodyPicks'

export interface BodyReading {
  id: string
  readout: MeasureReadout
  outline: Vec3[][]
  geometry?: AnalyticGeometry
}

const length = (label: string, value: number): MeasureRow => ({ label, value, unit: 'length', exact: true })
const position = (point: Vec3): MeasureRow => ({ label: 'Position (world XYZ)', point, value: 0, unit: 'point', exact: true })

function outlineOf(polyline: Float32Array): Vec3[] {
  const points: Vec3[] = []
  for (let i = 0; i + 2 < polyline.length; i += 3) points.push([polyline[i], polyline[i+1], polyline[i+2]])
  return points
}

export function bodyReading(hit: BodyMeasureHit): BodyReading {
  const readout: MeasureReadout = { kind: 'readout', title: '', rows: [], witness: [] }
  if (hit.kind === 'point') {
    readout.title = `Body ${hit.bodyId} · ${hit.label}`
    readout.rows = [position(hit.point)]
    readout.witness = [hit.point]
    return { id: `${readout.title}/${hit.point.join(',')}`, readout, outline: [], geometry: { kind: 'point', at: hit.point } }
  }
  if (hit.kind === 'edge') {
    const { bodyId, edge } = hit.hit
    const { kind, radius, length: size, dir } = edge.fingerprint
    readout.title = `Body ${bodyId} · ${kind === 'circle' ? 'Circular' : kind === 'line' ? 'Straight' : 'Curved'} edge`
    readout.rows = [length('Edge length', size)]
    let geometry: AnalyticGeometry | undefined
    if (kind === 'line') {
      geometry = { kind: 'segment', a: edge.ends[0], b: edge.ends[1] }
      readout.witness = [...edge.ends]
      readout.caption = { row: 0, sign: 'L' }
    }
    if (kind === 'circle' && radius !== undefined && edge.center) {
      readout.rows.unshift(length('Radius', radius), length('Diameter', 2 * radius))
      readout.rows.push({ ...position(edge.center), label: 'Center (world XYZ)' })
      readout.witness = [edge.center, edge.fingerprint.mid]
      readout.caption = { row: 0, sign: 'R' }
      // A partial arc has a radius, but its rim cannot be evaluated as an entire circle.
      if (Math.abs(size - 2*Math.PI*radius) <= 1e-10 * size) geometry = { kind: 'circle', center: edge.center, normal: dir, radius }
    }
    return { id: `edge/${bodyId}/${edge.hash}`, readout, geometry, outline: [outlineOf(edge.polyline)] }
  }
  const { bodyId, face, edges } = hit.hit
  const fp = face.fingerprint
  readout.title = `Body ${bodyId} · ${fp.kind === 'other' ? 'Curved' : fp.kind} face`
  readout.rows = [{ label: 'Face area', value: fp.area, unit: 'area', exact: true }]
  if ((fp.kind === 'cylinder' || fp.kind === 'sphere') && fp.radius !== undefined) readout.rows.push(length('Radius', fp.radius), length('Diameter', 2*fp.radius))
  const geometry = fp.kind === 'plane' ? { kind: 'plane' as const, at: fp.centroid, normal: fp.dir } : undefined
  return { id: `face/${bodyId}/${face.hash}`, readout, geometry, outline: edges.map(e => outlineOf(e.polyline)) }
}
