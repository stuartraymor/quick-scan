// SPDX-License-Identifier: AGPL-3.0-only
// Which way round a quad is wound (2026-11-18). A quad drawn on the screen
// shows the viewer its front whichever way its corners were picked — the
// rectangle tool wound half its drags the other way, and the quad came out
// in the reverse finish with no Tolerance colours or Zebra stripes — and two
// parts wound against one another join by turning one, where the second
// point of such a seam used to refuse to weld.
import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../../src/core/types'
import type { Cage } from '../core/freeform/cage'
import { addFace, closeHole, windConsistently } from '../core/freeform/edit'
import { mergeBoundaryPoint } from '../core/freeform/merge'

const empty = (): Cage => ({ positions: new Float64Array(), faces: [], creases: [] })
const cage = (points: Vec3[], faces: number[][]): Cage => ({ positions: Float64Array.from(points.flat()), faces, creases: [] })

/** The face's normal by the right-hand rule. */
function normal(c: Cage, face: number[]): Vec3 {
  const p = face.map((v) => [c.positions[v * 3], c.positions[v * 3 + 1], c.positions[v * 3 + 2]])
  const n: Vec3 = [0, 0, 0]
  for (let k = 1; k + 1 < p.length; k++) {
    const u = p[k].map((x, i) => x - p[0][i]), w = p[k + 1].map((x, i) => x - p[0][i])
    n[0] += u[1] * w[2] - u[2] * w[1]; n[1] += u[2] * w[0] - u[0] * w[2]; n[2] += u[0] * w[1] - u[1] * w[0]
  }
  return n
}

/** Every edge two faces share runs opposite ways in them. */
function consistent(faces: number[][]): boolean {
  const directed = new Set<string>()
  for (const f of faces) for (let k = 0; k < f.length; k++) {
    const key = `${f[k]}>${f[(k + 1) % f.length]}`
    if (directed.has(key)) return false
    directed.add(key)
  }
  return true
}

describe('a face drawn on the screen', () => {
  // Seen from +z, looking along -z: the front winds clockwise as seen, its
  // right-hand normal pointing away from the viewer.
  const down: Vec3 = [0, 0, -1]
  const counter: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]

  it('faces the viewer whichever way its corners were picked', () => {
    for (const corners of [counter, counter.slice().reverse()]) {
      const made = addFace(empty(), corners, down)
      expect(normal(made, made.faces[0])[2]).toBeLessThan(0)
    }
    // Seen from below, the same picks are wound the other way.
    expect(normal(addFace(empty(), counter, [0, 0, 1]), [0, 1, 2, 3])[2]).toBeGreaterThan(0)
  })

  it('keeps the picked order where no view is given', () => {
    expect(addFace(empty(), counter).faces).toEqual([[0, 1, 2, 3]])
  })

  it('follows a neighbour it shares an edge with, not the view', () => {
    const one = cage(counter, [[0, 1, 2, 3]])
    const made = addFace(one, [1, [2, 0, 0], [2, 1, 0], 2], down)
    expect(made.faces[0]).toEqual([0, 1, 2, 3])
    expect(consistent(made.faces)).toBe(true)
    expect(normal(made, made.faces[1])[2]).toBeGreaterThan(0)
  })
})

describe('parts wound against one another', () => {
  it('are turned to fit, the smaller part turning', () => {
    // Three quads in a row one way, and a fourth joined on wound the other.
    const faces = [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 7, 9, 8]]
    const wound = windConsistently(faces)
    expect(wound.slice(0, 3)).toEqual(faces.slice(0, 3))
    expect(wound[3]).toEqual([8, 9, 7, 3])
    expect(consistent(wound)).toBe(true)
  })

  it('keep the named faces where the parts are equal', () => {
    const faces = [[0, 1, 4, 3], [1, 4, 5, 2]]
    expect(windConsistently(faces, [0])).toEqual([[0, 1, 4, 3], [2, 5, 4, 1]])
    expect(windConsistently(faces, [1])).toEqual([[3, 4, 1, 0], [1, 4, 5, 2]])
  })

  it('come back untouched where they already agree', () => {
    const faces = [[0, 1, 4, 3], [1, 2, 5, 4]]
    expect(windConsistently(faces)).toBe(faces)
  })

  it('are refused where the join has a twist in it', () => {
    expect(() => windConsistently([[0, 1, 3, 2], [2, 3, 5, 4], [4, 5, 0, 1]])).toThrow(/twist/)
  })

  it('weld at both ends of a seam', () => {
    // Two unit quads 0.2 apart, the second wound the other way.
    const two = cage([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [1.2, 0, 0], [2.2, 0, 0], [2.2, 1, 0], [1.2, 1, 0]], [[0, 1, 2, 3], [4, 7, 6, 5]])
    const first = mergeBoundaryPoint(two, 4, 1)
    expect(first.cage.positions).toHaveLength(21)
    // Pole 7 is 6 once 4 has gone. This second weld was refused.
    const second = mergeBoundaryPoint(first.cage, 6, 2)
    expect(second.cage.positions).toHaveLength(18)
    expect(second.cage.faces).toHaveLength(2)
    expect(consistent(second.cage.faces)).toBe(true)
    // The quad dropped on keeps its sense; the one dragged turns.
    expect(second.cage.faces[0]).toEqual([0, 1, 2, 3])
    expect(normal(second.cage, second.cage.faces[0])[2] * normal(second.cage, second.cage.faces[1])[2]).toBeGreaterThan(0)
  })

  it('take a face between them, and a four-sided hole closed', () => {
    // A ring of four quads round a square hole, one of them wound the other way,
    // touching its neighbours only at their corners.
    const points: Vec3[] = []
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) points.push([i, j, 0])
    const at = (i: number, j: number) => j * 4 + i
    const quad = (i: number, j: number) => [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]
    const ring = cage(points, [quad(1, 0), quad(2, 1).reverse(), quad(1, 2), quad(0, 1)])
    const closed = closeHole(ring, [at(1, 1), at(2, 1), at(2, 2), at(1, 2)])
    expect(closed.faces).toHaveLength(5)
    expect(consistent(closed.faces)).toBe(true)
  })
})
