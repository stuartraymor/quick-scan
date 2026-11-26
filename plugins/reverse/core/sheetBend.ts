// SPDX-License-Identifier: AGPL-3.0-only
import type { Vec3 } from '../../../src/core/types'
import { add, addScaled, cross, dot, len, normalize, sub } from '../../../src/core/vec'
import type { SidedChamfer } from './chamferSides'
import type { LoopPiece, RawEdge, ReKernel, Shape } from './kernel'
import { polygonLoop } from './loops'

type SheetBend = { mode: 'variable'; radii: [number, number] } | SidedChamfer

/** A bend between two planar panels with transverse, free ends. The physical
 * end boundaries trim both contact rails. For a linear radius law the circular
 * end sections are homothetic, so their ruled loft is tangent along both rails. */
export function sheetBend(k: ReKernel, sheet: Shape, hash: number, law: SheetBend, flip = false): Shape {
  const edges = k.edges(sheet, 1)
  const edge = edges.find(e => e.hash === hash)
  const sides = k.edgeSides(sheet, [hash])[0]
  const unsupported = () => new Error('This sheet bend needs a straight shared edge between two planar panels with free transverse ends. Use a constant radius or equal-distance chamfer on other joined sheets.')
  if (!edge || edge.kind !== 'line' || !sides) throw unsupported()
  const axis = normalize(sub(edge.ends[1], edge.ends[0]))
  if (!axis) throw unsupported()
  const faces = k.faces(sheet)
  const supports = sides.faces.map(h => faces.find(f => f.hash === h)!)
  const tol = 1e-6
  const farEnd = (rails: RawEdge[], at: Vec3): Vec3 => {
    for (const rail of rails) {
      if (rail.faceHashes.length !== 1) continue
      const index = rail.ends.findIndex(p => len(sub(p, at)) <= tol)
      if (index !== -1) return rail.ends[1-index]
    }
    throw unsupported()
  }
  const panels = supports.map(face => {
    const rails = edges.filter(e => e.hash !== hash && e.faceHashes.includes(face.hash))
    if (face.kind !== 'plane' || rails.length !== 3 || rails.some(e => e.kind !== 'line')) throw unsupported()
    const far = edge.ends.map(p => farEnd(rails, p))
    const dirs = far.map((p, i) => normalize(sub(p, edge.ends[i])))
    const dir = dirs[0]
    if (!dir || !dirs[1] || len(sub(dir, dirs[1])) > 1e-8 || Math.abs(dot(dir, axis)) > 1e-8) throw unsupported()
    return { face, far, dir }
  })
  const [a,b] = panels.map(p => p.dir)
  const phi = Math.acos(Math.max(-1, Math.min(1, dot(a,b))))
  const bisector = normalize(add(a,b))
  if (!bisector || phi < 1e-5 || Math.PI - phi < 1e-5) throw unsupported()
  const contacts: Vec3[][] = [[], []]
  const sections = edge.ends.map((p, i): LoopPiece => {
    let first: number, second: number
    if (law.mode === 'variable') first = second = law.radii[i] / Math.tan(phi/2)
    else {
      first = law.distance
      if (law.mode === 'twoDistances') second = law.distance2
      else {
        const angle = law.angleDeg * Math.PI / 180
        if (!(angle > 0 && phi + angle < Math.PI)) throw new Error('This chamfer angle cannot reach the opposite panel.')
        second = first * Math.sin(angle) / Math.sin(phi + angle)
      }
      if (flip) [first,second] = [second,first]
    }
    for (const [side, d] of [first,second].entries()) {
      if (!(d > 0 && d < len(sub(panels[side].far[i], p)) - tol)) throw new Error('The requested bend extends beyond the panel. Reduce its dimensions.')
      contacts[side].push(addScaled(p, panels[side].dir, d))
    }
    const start = contacts[0][i], end = contacts[1][i]
    return law.mode === 'variable'
      ? { kind: 'arc', a: start, m: addScaled(p, bisector, law.radii[i] * (1/Math.sin(phi/2)-1)), b: end }
      : { kind: 'line', a: start, b: end }
  })
  const owned: Shape[] = []
  const keep = (s: Shape) => { owned.push(s); return s }
  try {
    const blend = keep(law.mode === 'variable'
      ? k.loft(sections.map(s => ({ outer: [s], holes: [] })), true, false)
      : k.face({ outer: polygonLoop([contacts[0][0],contacts[1][0],contacts[1][1],contacts[0][1]]), holes: [] }))
    const pieces = panels.map(({face, far}, side) => {
      const corners = [contacts[side][0],far[0],far[1],contacts[side][1]]
      if (dot(cross(sub(corners[1],corners[0]),sub(corners[2],corners[1])), face.dir) < 0) corners.reverse()
      return keep(k.face({ outer: polygonLoop(corners), holes: [] }))
    })
    for (const f of faces.filter(f => !sides.faces.includes(f.hash))) {
      const untouched = keep(k.faceCopy(sheet, f.hash))
      if (k.distanceBetween(untouched, blend) <= tol) throw new Error('The bend meets a neighboring face. Reduce its dimensions.')
      pieces.push(untouched)
    }
    const sewn = k.sewSheet([...pieces,blend], tol)
    keep(sewn.shape)
    if (sewn.pieces !== 1 || !k.isSurface(sewn.shape) || k.faceCount(sewn.shape) !== faces.length + 1 ||
        k.edgeUses(sewn.shape).shared !== k.edgeUses(sheet).shared + 1)
      throw new Error('The bend could not be joined along both contact rails.')
    owned.pop()
    return sewn.shape
  } finally { k.release(...owned) }
}
