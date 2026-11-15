// SPDX-License-Identifier: AGPL-3.0-only
import { seedOff } from '../../../../src/core/fit/seedOff'
import type { FitData, PlaneFit, Vec3 } from '../../../../src/core/types'
import { add, cross, dot, len, normalize, scale, sub } from '../../../../src/core/vec'
import { type Cage, topology, vertexAt } from './cage'
import { cageVertexLimits, limitPositions, vertexNormals } from './limit'
import { subdivided, vertexRule } from './subdivide'

/** Qualify whole boundary edges before moving their endpoints. A lone point
 * close to a plane is insufficient. Use the visible subdivision anchors
 * even when the control net is displayed. */
export function offsetBoundaryToPlanes(cage: Cage, planes: readonly PlaneFit[], extra: number): Cage {
  if (!(extra > 0 && Number.isFinite(extra)) || !planes.length) return cage
  const boundary = topology(cage).edges.filter(edge => edge.faces.length === 1)
  if (!boundary.length) return cage
  const anchors = cageVertexLimits(cage)
  const candidates = anchors.map(point => {
    let nearest = extra
    let target: Vec3 | undefined
    for (const { center, normal } of planes) {
      const relative: Vec3 = [point[0] - center[0], point[1] - center[1], point[2] - center[2]]
      const off = dot(relative, normal)
      if (Math.abs(off) > nearest) continue
      if (target && Math.abs(off) === nearest) continue
      nearest = Math.abs(off)
      const travel = (off > 0 ? -extra : extra) - off
      target = [point[0] + travel * normal[0], point[1] + travel * normal[1], point[2] + travel * normal[2]]
    }
    return target
  })
  const positions = cage.positions.slice()
  for (const { a, b } of boundary) {
    const start = candidates[a], end = candidates[b]
    if (start && end) {
      positions.set(start, a * 3)
      positions.set(end, b * 3)
    }
  }
  return { ...cage, positions }
}

/** The tolerance determines which limit anchors lie close to a primitive.
 * Their poles offset against the default direction, while the other poles
 * move with it. Displacements go on the cage before building the CAD. */
export function offsetByPrimitives(cage: Cage, references: readonly FitData[], tolerance: number): Cage {
  if (!(tolerance > 0 && Number.isFinite(tolerance)) || !references.length) return cage
  const anchors = cageVertexLimits(cage)
  const fine = subdivided(cage, 2)
  const normals = vertexNormals(fine.positions, fine.faces)
  const top = topology(cage)
  const fineTop = topology(fine)
  const limitCage = { ...fine, positions: limitPositions(fine) }
  const positions = cage.positions.slice()
  anchors.forEach((anchor, vertex) => {
    const i = vertex * 3
    let normal: Vec3 = [normals[i], normals[i + 1], normals[i + 2]]
    const boundary = top.vertexEdges[vertex].map(index => top.edges[index]).filter(edge => edge.faces.length === 1)
    if (boundary.length === 2 && top.vertexFaces[vertex].length === 1) {
      const straight = boundary.map(edge => edge.a === vertex ? edge.b : edge.a)
        .filter(other => vertexRule(top, other) === 'corner')
      let facetNormal: Vec3 | null = null
      if (straight.length === 2) {
        facetNormal = normalize(cross(sub(vertexAt(cage, straight[0]), anchor), sub(vertexAt(cage, straight[1]), anchor)))
      } else if (straight.length === 1) {
        // Take the facet that touches the straight boundary of the local
        // limit cell. On a twisted cell the opposite triangle can have a
        // substantially different normal even though both meet this pole.
        const original = cage.faces[top.vertexFaces[vertex][0]]
        const next = original[(original.indexOf(vertex) + 1) % original.length]
        const cell = fine.faces[fineTop.vertexFaces[vertex][0]]
        const a = vertexAt(limitCage, cell[next === straight[0] ? 1 : 3])
        const b = vertexAt(limitCage, cell[next === straight[0] ? 3 : 1])
        const opposite = vertexAt(limitCage, cell[2])
        const third = len(sub(opposite, anchor)) < len(sub(a, b)) ? opposite : b
        facetNormal = normalize(cross(sub(a, anchor), sub(third, anchor)))
      }
      if (facetNormal) normal = dot(facetNormal, normal) < 0 ? scale(facetNormal, -1) : facetNormal
    } else if (boundary.length === 2 && vertexRule(top, vertex) === 'crease') {
      // Use the one-sided tangents on the limit surface for a smooth
      // boundary. Equal contributions avoid bias toward larger facets.
      let sum: Vec3 = [0, 0, 0]
      for (const faceIndex of fineTop.vertexFaces[vertex]) {
        const face = fine.faces[faceIndex]
        const corner = face.indexOf(vertex)
        const from = sub(vertexAt(limitCage, face[(corner + 1) % face.length]), anchor)
        const to = sub(vertexAt(limitCage, face[(corner + face.length - 1) % face.length]), anchor)
        const direction = normalize(cross(from, to))
        if (direction) sum = add(sum, direction)
      }
      normal = normalize(sum) ?? normal
    }
    const near = references.some(reference => {
      const reading = seedOff(reference, anchor, normal)
      return reading !== null && Math.abs(reading.offMm) <= tolerance
    })
    const travel = (near ? 2 : -2) * tolerance
    positions[i] += normal[0] * travel
    positions[i + 1] += normal[1] * travel
    positions[i + 2] += normal[2] * travel
  })
  return { ...cage, positions }
}
