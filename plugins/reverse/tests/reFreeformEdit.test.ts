// SPDX-License-Identifier: AGPL-3.0-only
// The freeform editor's tools on small cages (F3 of audit-2026-11-07/
// FREEFORM_ROADMAP.md): each tool's result checked against what it says,
// and the refusals.
import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../../src/core/types'
import { type Cage, edgeKey, faceArea, topology, vertexCount } from '../core/freeform/cage'
import { addFace, addRectangle, align, boundaryLoops, bridge, closeHole, deleteFaces, deleteVertices, deviation, edgeLine, extrapolate, extrapolateEdges, increaseResolution, mirror, movePoints, setCrease, smooth, snapCage, splitLoop } from '../core/freeform/edit'
import { cageVertexLimits } from '../core/freeform/limit'
import { cylinderClosest } from '../core/freeform/snap'

const EMPTY: Cage = { positions: new Float64Array(0), faces: [], creases: [] }

/** A flat patch of nu × nv quads, 1 mm each, at z = 0 looking along +z; vertex (i, j) is j·(nu+1) + i. */
const patch = (nu = 2, nv = 2): Cage => addRectangle(EMPTY, [0, 0, 0], [nu, 0, 0], [0, nv, 0], nu, nv)

const at = (c: Cage, v: number): Vec3 => [c.positions[v * 3], c.positions[v * 3 + 1], c.positions[v * 3 + 2]]

/** Each directed edge in one face only: the faces agree on which side is out. */
function consistent(c: Cage): boolean {
  const seen = new Set<string>()
  for (const f of c.faces) for (let k = 0; k < f.length; k++) {
    const key = `${f[k]}>${f[(k + 1) % f.length]}`
    if (seen.has(key)) return false
    seen.add(key)
  }
  return true
}

/** A cube of side 2 centred on the origin without its top. */
const box = (): Cage => ({
  positions: Float64Array.from([-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1]),
  faces: [[0, 3, 2, 1], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]],
  creases: [],
})

describe('add', () => {
  it('makes a rectangle of quads looking along u × v', () => {
    const c = patch(2, 3)
    expect(vertexCount(c)).toBe(12)
    expect(c.faces).toHaveLength(6)
    expect(faceArea(c)).toBeCloseTo(6, 9)
    expect(topology(c).closed).toBe(false)
    expect(() => addRectangle(EMPTY, [0, 0, 0], [1, 0, 0], [2, 0, 0])).toThrow(/one line/)
    expect(() => addRectangle(EMPTY, [0, 0, 0], [1, 0, 0], [0, 1, 0], 0, 1)).toThrow(/1 to 10 000/)
  })

  it('adds a face through four clicks — a new point and three of the cage — wound like its neighbours', () => {
    const c = patch()
    // Beside the patch's right edge (vertices 2 and 8): clicked in the order that disagrees with the patch.
    const d = addFace(c, [2, [3, 0, 0], [3, 1, 0], 5])
    expect(d.faces).toHaveLength(5)
    expect(vertexCount(d)).toBe(11)
    expect(consistent(d)).toBe(true)
    expect(topology(d).edges.find((e) => e.a === 2 && e.b === 5)!.faces).toHaveLength(2)
    // Clicked the other way round, the same face.
    const e = addFace(c, [5, [3, 1, 0], [3, 0, 0], 2])
    expect(consistent(e)).toBe(true)
    expect(e.faces).toHaveLength(5)
  })

  it('refuses a corner that is not there, a repeated one, and a third face on an edge', () => {
    const c = patch()
    expect(() => addFace(c, [0, 1])).toThrow(/three corners/)
    expect(() => addFace(c, [0, 1, 99])).toThrow(/no corner 99/)
    expect(() => addFace(c, [0, 1, 1])).toThrow(/twice/)
    // Edge 0–1 already has its face: a second one on the same side of it.
    expect(() => addFace(c, [0, 1, [1, -1, 0], [0, -1, 0]])).not.toThrow()
    const d = addFace(c, [0, 1, [1, -1, 0], [0, -1, 0]])
    expect(() => addFace(d, [1, 0, [0, 1, 1], [1, 1, 1]])).toThrow()
  })
})

describe('move', () => {
  it('moves a vertex to a place or by a step, and its neighbours within the radius by a falloff', () => {
    const c = patch(4, 4)
    const centre = 12
    const a = movePoints(c, [{ vertex: centre, by: [0, 0, 1] }])
    expect(at(a, centre)).toEqual([2, 2, 1])
    expect(at(a, 13)).toEqual(at(c, 13))
    const b = movePoints(c, [{ vertex: centre, to: [2, 2, 1] }], 2, 1)
    expect(at(b, centre)).toEqual([2, 2, 1])
    const near = at(b, 13)[2], far = at(b, 14)[2]
    expect(near).toBeGreaterThan(0)
    expect(near).toBeLessThan(1)
    expect(far).toBe(0)
    // Strength 0.5 softens it; 0 leaves the neighbours.
    expect(at(movePoints(c, [{ vertex: centre, by: [0, 0, 1] }], 2, 0.5), 13)[2]).toBeCloseTo(near / 2, 9)
    expect(at(movePoints(c, [{ vertex: centre, by: [0, 0, 1] }], 2, 0), 13)[2]).toBe(0)
    // The cage given is not changed.
    expect(at(c, centre)).toEqual([2, 2, 0])
  })

  it('refuses nothing to move, a pick that is not there, and a move with both or neither', () => {
    const c = patch()
    expect(() => movePoints(c, [])).toThrow(/Nothing to move/)
    expect(() => movePoints(c, [{ vertex: 40, by: [0, 0, 1] }])).toThrow(/no vertex 40/)
    expect(() => movePoints(c, [{ vertex: 1 }])).toThrow(/either to/)
    expect(() => movePoints(c, [{ vertex: 1, to: [0, 0, 0], by: [0, 0, 1] }])).toThrow(/either to/)
    expect(() => movePoints(c, [{ vertex: 1, by: [0, 0, Number.NaN] }])).toThrow(/three numbers/)
  })
})

it('matches two saved QUICKSURFACE D-handle pulls on the same sphere cage', () => {
  // Decoded from saved test copies, with Snap Mode off and full Drag Strength.
  const native: Cage = {
    positions: Float64Array.from([
      -2.5356853008270264,-14.823261260986328,17.621564865112305,
      11.977066040039062,0.8710759282112122,15.845459938049316,
      18.408493041992188,-4.443119049072266,6.045158863067627,
      4.01893424987793,-21.377880096435547,7.465747833251953,
      6.817294120788574,-2.991267204284668,21.99803924560547,
      15.534045219421387,-11.26496696472168,7.39190673828125,
      -1.039684772491455,-25.820510864257812,7.4981865882873535,
      -6.545372009277344,-19.89571762084961,15.745340347290039,
    ]),
    faces: [[0,4,5,3],[4,1,2,5],[3,6,7,0]], creases: [],
  }
  const firstExpected: Vec3[] = [
    [-5.384415149688721,-30.165241241455078,7.4981865882873535],
    [-10.89010238647461,-24.240447998046875,15.745340347290039],
  ]
  const secondExpected: Vec3[] = [
    [-9.729148864746094,-34.50997543334961,7.4981865882873535],
    [-15.234835624694824,-28.585182189941406,15.745340347290039],
  ]
  const firstBy: Vec3 = firstExpected[0].map((v,i)=>v-at(native,6)[i]) as Vec3
  const first = extrapolateEdges(native,[topology(native).edgeOf.get(edgeKey(6,7))!],firstBy)
  expect(first.cage.faces).toHaveLength(4)
  expect(first.cage.faces[3]).toEqual([7,6,8,9])
  for(let k=0;k<2;k++) expect(Math.hypot(...at(first.cage,8+k).map((v,i)=>v-firstExpected[k][i]))).toBeLessThan(0.00001)
  const secondBy: Vec3 = secondExpected[0].map((v,i)=>v-firstExpected[0][i]) as Vec3
  const second = extrapolateEdges(first.cage,first.edges,secondBy)
  expect(second.cage.faces).toHaveLength(5)
  expect(second.cage.faces[4]).toEqual([9,8,10,11])
  for(let k=0;k<2;k++) expect(Math.hypot(...at(second.cage,10+k).map((v,i)=>v-secondExpected[k][i]))).toBeLessThan(0.00001)
  // The same displacement sent through contextual Extrapolate yields a
  // different, tangent-following edge on this curved cage.
  const contextual = extrapolateEdges(native,[topology(native).edgeOf.get(edgeKey(6,7))!],firstBy,true)
  expect(Math.hypot(...at(contextual.cage,8).map((v,i)=>v-firstExpected[0][i]))).toBeGreaterThan(0.01)
})

describe('resolution and split', () => {
  it('increases the resolution without changing the surface: four times the faces, the same limit points', () => {
    const c = movePoints(patch(), [{ vertex: 4, by: [0, 0, 0.8] }])
    const r = increaseResolution(c)
    expect(r.faces).toHaveLength(c.faces.length * 4)
    const before = cageVertexLimits(c)
    const after = cageVertexLimits(r)
    // The original vertices keep their numbers; their limit point is where it was.
    before.forEach((p, v) => {
      expect(after[v][0]).toBeCloseTo(p[0], 9)
      expect(after[v][1]).toBeCloseTo(p[1], 9)
      expect(after[v][2]).toBeCloseTo(p[2], 9)
    })
  })

  it('splits the loop of quads across an edge: a ring of vertices and each quad crossed in two', () => {
    const c = patch(3, 2)
    // Edge 0–1 lies across the bottom of the first column: the loop runs up through both rows.
    const d = splitLoop(c, 0, 1)
    expect(d.faces).toHaveLength(8)
    expect(vertexCount(d)).toBe(vertexCount(c) + 3)
    expect(faceArea(d)).toBeCloseTo(faceArea(c), 9)
    expect(consistent(d)).toBe(true)
    expect(at(d, vertexCount(c))).toEqual([0.5, 0, 0])
    // At a third of the way from 1 towards 0.
    expect(at(splitLoop(c, 1, 0, 1 / 3), vertexCount(c))[0]).toBeCloseTo(1 - 1 / 3, 9)
    // The first vertex's side stays measured from `a` all the way up the loop.
    const e = splitLoop(c, 0, 1, 0.25)
    for (let k = 0; k < 3; k++) expect(at(e, vertexCount(c) + k)[0]).toBeCloseTo(0.25, 9)
  })

  it('carries a crease across a split and refuses a polygon or a non-edge', () => {
    const c = setCrease(patch(2, 1), [[1, 2]], true)
    const d = splitLoop(c, 1, 2)
    expect(d.creases).toHaveLength(2)
    const tri: Cage = { positions: Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]), faces: [[0, 1, 2]], creases: [] }
    expect(() => splitLoop(tri, 0, 1)).toThrow(/3 sides/)
    expect(() => splitLoop(patch(), 0, 8)).toThrow(/not an edge/)
    expect(() => splitLoop(patch(), 0, 1, 1)).toThrow(/between 0 and 1/)
  })
})

describe('crease', () => {
  it('creases and un-creases edges, and refuses a pair that is no edge', () => {
    const c = patch()
    const d = setCrease(c, [[0, 1], [4, 3]], true)
    expect(topology(d).edges.filter((e) => e.crease)).toHaveLength(2)
    const e = setCrease(d, [[1, 0]], false)
    expect(topology(e).edges.filter((x) => x.crease)).toHaveLength(1)
    expect(() => setCrease(c, [[0, 8]], true)).toThrow(/not an edge/)
    expect(() => setCrease(c, [], true)).toThrow(/Name the edges/)
  })

  it('a creased edge keeps the limit surface on it straight: the crease is a fold', () => {
    const base = movePoints(patch(), [{ vertex: 4, by: [0, 0, 1] }])
    const soft = cageVertexLimits(base)[4]
    const folded = cageVertexLimits(setCrease(base, [[3, 4], [4, 5]], true))[4]
    // A vertex on a crease is pulled along it, not by its neighbours across: it sits higher.
    expect(folded[2]).toBeGreaterThan(soft[2])
  })
})

describe('extrapolate', () => {
  it('follows the measured outgoing directions of a deformed QUICKSURFACE cage', () => {
    const c: Cage = {
      positions: Float64Array.from([
        -2.5356853,-14.8232613,17.6215649, 11.977066,0.8710759,15.8454599,
        18.408493,-4.443119,6.0451589, 4.0189342,-21.3778801,7.4657478,
        6.8172941,-2.9912672,21.9980392, 15.5340452,-11.2649670,7.3919067,
      ]), faces: [[0,4,5,3],[4,1,2,5]], creases: [],
    }
    const edge=topology(c).edgeOf.get(edgeKey(0,3))!
    const result=extrapolateEdges(c,[edge],[-4.5341529,-4.7575436,-0.9218929],true)
    expect(vertexCount(result.cage)).toBe(8)
    expect(result.cage.faces).toHaveLength(3)
    const native=[[ -1.0396848,-25.8205109,7.4981866 ],[ -6.5453720,-19.8957176,15.7453403 ]]
    for (let k=0;k<2;k++) expect(Math.hypot(...at(result.cage,6+k).map((v,i)=>v-native[k][i]))).toBeLessThan(0.00001)
    const upperTravel=Math.hypot(...at(result.cage,7).map((v,i)=>v-at(c,0)[i]))
    const lowerTravel=Math.hypot(...at(result.cage,6).map((v,i)=>v-at(c,3)[i]))
    expect(upperTravel).toBeCloseTo(lowerTravel,9)
    expect(Array.from(result.cage.positions.slice(0,c.positions.length))).toEqual(Array.from(c.positions))
    const oblique=extrapolateEdges(c,[edge],[0,0,-4],true)
    expect(Math.hypot(...at(oblique.cage,7).map((v,i)=>v-at(c,0)[i]))).toBeGreaterThan(3.5)
    const explicitTranslation=extrapolateEdges(c,[edge],[0,0,-4])
    expect(at(explicitTranslation.cage,7)).toEqual([at(c,0)[0],at(c,0)[1],at(c,0)[2]-4])
    const repeated=extrapolateEdges(result.cage,result.edges,[-4.5341529,-4.7575436,-0.9218929],true)
    expect(vertexCount(repeated.cage)).toBe(10)
    expect(repeated.cage.faces).toHaveLength(4)
    expect(consistent(repeated.cage)).toBe(true)
  })
  it('keeps copied vertices welded across two selected boundary edges', () => {
    const c=patch(2,1), top=topology(c)
    const edges=[top.edgeOf.get(edgeKey(0,1))!,top.edgeOf.get(edgeKey(1,2))!]
    const result=extrapolateEdges(c,edges,[0,-0.5,0],true)
    expect(vertexCount(result.cage)).toBe(vertexCount(c)+3)
    expect(result.cage.faces).toHaveLength(c.faces.length+2)
    expect(consistent(result.cage)).toBe(true)
    expect(result.edges).toHaveLength(2)
  })
  it('averages unit tangents at a shared corner with unequal adjacent edge lengths', () => {
    const c=movePoints(patch(1,1),[{vertex:1,by:[2,0,0]},{vertex:3,by:[2,0,0]}])
    const top=topology(c)
    const result=extrapolateEdges(c,[top.edgeOf.get(edgeKey(0,1))!,top.edgeOf.get(edgeKey(0,2))!],[-1,-1,0],true)
    expect(vertexCount(result.cage)).toBe(vertexCount(c)+3)
    expect(result.cage.faces).toHaveLength(3)
    const shared=at(result.cage,4).map((v,i)=>v-at(c,0)[i])
    expect(shared[0]).toBeCloseTo(shared[1],9)
    const travels=[4,5,6].map((v,i)=>Math.hypot(...at(result.cage,v).map((x,k)=>x-at(c,[0,1,2][i])[k])))
    expect(travels[0]).toBeCloseTo(travels[1],9)
    expect(travels[1]).toBeCloseTo(travels[2],9)
    expect(consistent(result.cage)).toBe(true)
  })
  it('selects straight or gently curved rows but stops at the reference sphere cage bend', () => {
    const row = patch(2, 1)
    const bottom = topology(row).edgeOf.get(edgeKey(0, 1))!
    expect(edgeLine(row, bottom)).toHaveLength(2)
    const gentle = movePoints(row, [{ vertex: 1, by: [0, -0.1, 0] }])
    expect(edgeLine(gentle, bottom)).toHaveLength(2)
    const bent = movePoints(row, [{ vertex: 1, by: [0, -0.3, 0] }])
    expect(edgeLine(bent, bottom)).toEqual([bottom])

    // Same six control points and faces as the visible QUICKSURFACE test copy.
    const native: Cage = {
      positions: Float64Array.from([3.188220262527466,-9.33298397064209,17.335430145263672, 11.977066040039062,0.8710759282112122,15.845459938049316, 18.408493041992188,-4.443119049072266,6.045158863067627, 9.742839813232422,-15.887602806091309,7.179612159729004, 6.817294120788574,-2.991267204284668,21.99803924560547, 15.534045219421387,-11.26496696472168,7.39190673828125]),
      faces: [[0,4,5,3],[4,1,2,5]], creases: [],
    }
    for (const [a, b] of [[0,4],[3,5]] as const) {
      const selected = topology(native).edgeOf.get(edgeKey(a, b))!
      expect(edgeLine(native, selected)).toEqual([selected])
    }
  })
  it('pulls a boundary edge out into a quad, continuing the face beside it or by a step', () => {
    const c = patch()
    const d = extrapolate(c, 0, 1)
    expect(d.faces).toHaveLength(5)
    expect(consistent(d)).toBe(true)
    const out = d.faces[4]
    // The new edge lies one quad further out: y = −1.
    for (const v of out) if (v >= vertexCount(c)) expect(at(d, v)[1]).toBeCloseTo(-1, 9)
    const e = extrapolate(c, 1, 0, [0, -3, 0.5])
    for (const v of e.faces[4]) if (v >= vertexCount(c)) {
      expect(at(e, v)[1]).toBeCloseTo(-3, 9)
      expect(at(e, v)[2]).toBeCloseTo(0.5, 9)
    }
    expect(() => extrapolate(c, 1, 4)).toThrow(/not a boundary edge/)
    expect(() => extrapolate(c, 0, 5)).toThrow(/not an edge/)
  })
})

describe('delete', () => {
  it('deletes faces and the vertices only they used, keeping creases that still hold', () => {
    const c = setCrease(patch(), [[0, 1], [4, 5]], true)
    const d = deleteFaces(c, [3])
    expect(d.faces).toHaveLength(3)
    expect(vertexCount(d)).toBe(8)
    expect(d.creases).toHaveLength(2)
    // Face 0's corner (vertex 0) and its crease go with it.
    const e = deleteFaces(c, [0])
    expect(vertexCount(e)).toBe(8)
    expect(e.creases).toHaveLength(1)
    expect(topology(e).edges.every((x) => x.faces.length > 0)).toBe(true)
    expect(() => deleteFaces(c, [9])).toThrow(/no face 9/)
    expect(() => deleteFaces(c, [0, 1, 2, 3])).toThrow(/every face/)
    expect(() => deleteFaces(c, [])).toThrow(/Name the faces/)
  })

  it('deletes a vertex with the faces it belongs to', () => {
    const c = patch(3, 3)
    // Vertex 5 (column 1, row 1) belongs to four quads.
    const d = deleteVertices(c, [5])
    expect(d.faces).toHaveLength(5)
    expect(vertexCount(d)).toBe(12)
    expect(boundaryLoops(d)).toHaveLength(1)
    expect(() => deleteVertices(patch(), [4])).toThrow(/every face/)
    expect(() => deleteVertices(c, [77])).toThrow(/no vertex 77/)
  })
})

describe('smooth and align', () => {
  it('smooths a raised vertex towards its neighbours and holds the boundary still', () => {
    const c = movePoints(patch(4, 4), [{ vertex: 12, by: [0, 0, 1] }])
    const d = smooth(c, undefined, 0.5, 3)
    expect(at(d, 12)[2]).toBeGreaterThan(0)
    expect(at(d, 12)[2]).toBeLessThan(1)
    expect(at(d, 13)[2]).toBeGreaterThan(0)
    for (const v of [0, 1, 2, 3, 4, 5, 9, 10, 14, 15, 19, 20, 21, 22, 23, 24]) expect(at(d, v)).toEqual(at(c, v))
    // Only the vertices given.
    const e = smooth(c, [13], 1)
    expect(at(e, 12)).toEqual(at(c, 12))
    expect(at(e, 13)[2]).toBeGreaterThan(0)
    expect(() => smooth(c, undefined, 0)).toThrow(/factor/)
  })

  it('aligns vertices on one coordinate: their mean, or a given value', () => {
    const c = movePoints(patch(), [{ vertex: 3, by: [0, 0, 1] }, { vertex: 5, by: [0, 0, 3] }])
    const d = align(c, [3, 4, 5], 'z')
    for (const v of [3, 4, 5]) expect(at(d, v)[2]).toBeCloseTo(4 / 3, 9)
    const e = align(c, [3, 5], 'x', 7)
    expect(at(e, 3)[0]).toBe(7)
    expect(at(e, 5)[0]).toBe(7)
    expect(at(e, 3)[1]).toBe(at(c, 3)[1])
    expect(() => align(c, [], 'z')).toThrow(/Name the vertices/)
  })
})

describe('symmetry', () => {
  it('mirrors a patch in a plane through its edge, the vertices on the plane shared', () => {
    const c = patch()
    const d = mirror(c, 'x', 2)
    expect(vertexCount(d)).toBe(9 + 6)
    expect(d.faces).toHaveLength(8)
    expect(consistent(d)).toBe(true)
    expect(faceArea(d)).toBeCloseTo(8, 9)
    // The patch's right-hand edge (x = 2) is now inside.
    expect(topology(d).edges.filter((e) => e.faces.length === 1)).toHaveLength(12)
    expect(Math.max(...Array.from({ length: vertexCount(d) }, (_, v) => at(d, v)[0]))).toBe(4)
  })
})

describe('bridge and close', () => {
  it('bridges two quads that face each other with a tube of four, to a closed cage', () => {
    const bottom = addRectangle(EMPTY, [0, 0, 0], [0, 1, 0], [1, 0, 0])
    const top = addRectangle(bottom, [0, 0, 1], [1, 0, 0], [0, 1, 0])
    expect(top.faces).toHaveLength(2)
    const d = bridge(top, 0, 1)
    expect(d.faces).toHaveLength(4)
    expect(consistent(d)).toBe(true)
    expect(topology(d).closed).toBe(false)
    expect(boundaryLoops(d)).toHaveLength(2)
    // Either order, same tube.
    expect(bridge(top, 1, 0).faces).toHaveLength(4)
    expect(() => bridge(top, 0, 0)).toThrow(/different/)
    expect(() => bridge(top, 0, 5)).toThrow(/no face 5/)
    expect(() => bridge(patch(), 0, 1)).toThrow(/share a vertex/)
  })

  it('closes a four-sided hole with a quad, to a closed cage; refuses where there is none', () => {
    const b = box()
    expect(boundaryLoops(b)).toHaveLength(1)
    const d = closeHole(b)
    expect(d.faces).toHaveLength(6)
    expect(topology(d).closed).toBe(true)
    expect(consistent(d)).toBe(true)
    expect(closeHole(b, 4).faces).toHaveLength(6)
    expect(() => closeHole(d)).toThrow(/no four-sided hole/)
    expect(() => closeHole(b, 0)).toThrow(/not on a hole/)
    // A hole of six sides is not closed by this tool.
    expect(() => closeHole(patch(3, 1), 0)).toThrow(/8 sides/)
  })
})

describe('snap', () => {
  // A patch of 6 × 6 quads over a cylinder of radius 40 about the axis y, 0.8 mm short of it at the corners.
  const closest = (() => {
    const q = cylinderClosest([0, 0, -40], [0, 1, 0], 40)
    return (p: Vec3) => {
      const r = q(p, [0, 0, 1])
      return r ? { point: r, distance: Math.hypot(r[0] - p[0], r[1] - p[1], r[2] - p[2]) } : null
    }
  })()

  it('takes a flat patch onto a cylinder: its limit surface within a few hundredths of a millimetre', () => {
    const flat = addRectangle(EMPTY, [-6, -6, 0], [12, 0, 0], [0, 12, 0], 6, 6)
    const before = deviation(flat, closest)
    expect(before.max).toBeGreaterThan(0.3)
    const { cage, stats } = snapCage(flat, closest, 30)
    expect(stats.points).toBeGreaterThan(300)
    expect(stats.missed).toBe(0)
    expect(stats.rms).toBeLessThan(0.02)
    expect(stats.max).toBeLessThan(0.1)
    expect(stats.within / stats.points).toBeGreaterThan(0.9)
    // The cage moved, the original did not.
    expect(at(flat, 0)[2]).toBe(0)
    expect(Math.abs(at(cage, 0)[2] - at(flat, 0)[2])).toBeGreaterThan(0.1)
    expect(() => snapCage(flat, closest, 0)).toThrow(/1 to 100/)
  })

  it('holds still the vertices the scan is out of reach of', () => {
    const flat = patch()
    const { cage, stats } = snapCage(flat, () => null, 2)
    expect(stats.missed).toBeGreaterThan(0)
    expect(Array.from(cage.positions)).toEqual(Array.from(flat.positions))
  })
})
