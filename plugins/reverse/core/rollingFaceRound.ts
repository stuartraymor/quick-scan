// SPDX-License-Identifier: AGPL-3.0-only
import type { Vec3 } from '../../../src/core/types'
import { add, addScaled, cross, dot, len, mid, normalize, scale, sub } from '../../../src/core/vec'
import { vec, xyz } from './kernelMath'
import { HASH_BOUND, loneSolid } from './kernelOps'
import type { Shape } from './kernelTypes'
import type { OcctLike } from './occtTypes'

function unit(v: Vec3): Vec3 {
  const n = normalize(v)
  if (!n) throw new Error('The selected strip pinches to a point.')
  return n
}

function contact(o: OcctLike, face: number, c: Vec3) {
  const { u, v } = o.uvFromPoint(face, xyz(c))
  return { p: vec(o.pointOnSurface(face, u, v)), n: unit(vec(o.surfaceNormal(face, u, v))), u, v }
}

/** Closest point on the intersection with an end plane. Re-project onto
 * the actual support as its section normal turns on a curved end. */
function capContact(o: OcctLike, face: number, c: Vec3, axis: Vec3) {
  let q = c
  for (let i = 0; i < 24; i++) {
    const f = contact(o, face, q)
    const n = unit(addScaled(f.n, axis, -dot(f.n, axis)))
    const next = addScaled(c, n, -dot(sub(c, f.p), f.n) / dot(f.n, n))
    if (len(sub(next, q)) < 1e-8) return { ...f, p: next, n }
    q = next
  }
  throw new Error('The end profile could not be located on the side faces.')
}

/** A sphere inside the three picked supports. Fix its longitudinal coordinate
 * and solve for its two transverse coordinates and radius. Each normal gives
 * one linearized signed-distance constraint. */
function section(o: OcctLike, faces: number[], a: Vec3, b: Vec3, axis: Vec3, cap: boolean) {
  const u = unit(cross(axis, sub(b, a))), v = unit(cross(axis, u))
  let c = mid(a, b), r = len(sub(a, b)) / 2
  for (let iter = 0; iter < 25; iter++) {
    const feet = faces.map(f => cap ? capContact(o, f, c, axis) : contact(o, f, c))
    const normals = feet.map(f => f.n)
    const eq: Vec3[] = normals.map(n => [dot(n, u), dot(n, v), 1])
    const residual: Vec3 = [0, 0, 0]
    for (let i = 0; i < 3; i++) residual[i] = -r - dot(sub(c, feet[i].p), feet[i].n)
    const denom = dot(eq[0], cross(eq[1], eq[2]))
    if (Math.abs(denom) < 1e-8) throw new Error('The three supports do not define a unique inside round.')
    const delta = scale(add(add(scale(cross(eq[1], eq[2]), residual[0]), scale(cross(eq[2], eq[0]), residual[1])), scale(cross(eq[0], eq[1]), residual[2])), 1 / denom)
    if (len(delta) < 1e-8) {
      if (!(r > 1e-6)) throw new Error('The rolling radius must stay positive.')
      const hits = normals.map(n => addScaled(c, n, r))
      for (let i = 0; i < 3; i++) {
        const f = contact(o, faces[i], hits[i])
        if (len(sub(f.p, hits[i])) > 1e-4 || o.classifyPointOnFace(faces[i], f.u, f.v) === 'out')
          throw new Error('A contact point leaves the picked faces.')
      }
      return hits
    }
    c = addScaled(addScaled(c, u, delta[0]), v, delta[1])
    r += delta[2]
  }
  throw new Error('The three-face tangency did not converge.')
}

/** Locate each rail on successive parallel planes, independently of the
 * parameterization (and orientation) of the two rail curves. */
function railSampler(o: OcctLike, edge: number, axis: Vec3, origin: Vec3, span: number) {
  const { first, last } = o.curveParameters(edge)
  const point = (t: number) => vec(o.curvePointAtParam(edge, t))
  const height = (p: Vec3) => dot(sub(p, origin), axis)
  const inc = height(point(last)) > height(point(first))
  const start = inc ? first : last, end = inc ? last : first
  let prev = -Infinity
  for (let i = 0; i <= 32; i++) {
    const h = height(point(start + (end - start) * i / 32))
    if (h <= prev || (i === 0 && Math.abs(h) > 1e-5) || (i === 32 && Math.abs(h - span) > 1e-5))
      throw new Error('Each side edge must run continuously between the two ends.')
    prev = h
  }
  return (t: number) => {
    if (t === 0 || t === 1) return point(t === 0 ? start : end)
    let lo = start, hi = end
    for (let i = 0; i < 36; i++) {
      const m = (lo + hi) / 2
      if (height(point(m)) < t * span) lo = m
      else hi = m
    }
    return point((lo + hi) / 2)
  }
}

export function rollingFaceRound(o: OcctLike, solid: Shape, faces: number[], rails: number[], caps: number[]): Shape {
  const capPoints = caps.map(f => vec(o.getSurfaceCenterOfMass(f)))
  const endNormals = caps.map((f, i) => contact(o, f, capPoints[i]).n)
  if (dot(endNormals[0], endNormals[1]) > -1 + 1e-7) throw new Error('The varying-width strip needs opposite parallel end planes.')
  const axis = endNormals[1], span = dot(sub(capPoints[1], capPoints[0]), axis)
  if (span <= 1e-6) throw new Error('The ends of the strip must be distinct.')
  const sample = rails.map(edge => railSampler(o, edge, axis, capPoints[0], span))
  const owned: number[] = []
  const keep = (h: number) => { owned.push(h); return h }
  const subs = (s: number, type: 'face' | 'solid') => o.getSubShapes(s, type).map(keep)
  const wire = (edges: number[]) => keep(o.makeWire(edges))
  const line = (a: Vec3, b: Vec3) => keep(o.makeLineEdge(xyz(a), xyz(b)))
  try {
    const arcs: number[] = [], dividers: number[] = [], endFaces: number[] = []
    const count = 24
    for (let i = 0; i <= count; i++) {
      const atEnd = i === 0 || i === count
      const [a, crest, b] = section(o, faces, sample[0](i / count), sample[1](i / count), axis, atEnd)
      const arc = keep(o.makeArcEdge(xyz(a), xyz(crest), xyz(b)))
      arcs.push(wire([arc]))
      const across = sub(b, a)
      dividers.push(wire([line(addScaled(a, across, -0.25), addScaled(b, across, 0.25))]))
      if (atEnd) endFaces.push(keep(o.makeFace(wire([arc, line(b, a)]))))
    }
    // Split at the chord of the blend, preserving the rest of the original
    // solid and its trimmed faces. Replace only the portion in front of it.
    const divider = keep(o.loft(dividers, false, false))
    const split = keep(o.split(solid, [divider])), parts = subs(split, 'solid')
    if (parts.length !== 2) throw new Error('The contact strip could not be isolated from the body.')
    const pieces = parts.map(p => subs(p, 'face'))
    const hash = (h: number) => o.hashCode(h, HASH_BOUND)
    const center = hash(faces[1]), front = pieces.findIndex(fs => fs.some(f => hash(f) === center))
    if (front < 0) throw new Error('The cut would extend outside the selected center strip.')
    const frontFaces = new Set(pieces[front].map(hash))
    const rear = pieces[1 - front].filter(f => !frontFaces.has(hash(f)))
    if (pieces[1 - front].length - rear.length !== 1 || pieces[front].length !== 6)
      throw new Error('The selected strip intersects another face or opening.')
    const blend = keep(o.loft(arcs, false, false))
    const tolerance = Math.min(1e-3, Math.max(1e-5, span * 2e-6))
    const sewed = keep(loneSolid(o, o.sewAndSolidify([...rear, ...subs(blend, 'face'), ...endFaces], tolerance)))
    const result = loneSolid(o, o.unifySameDomain(sewed))
    try {
      if (o.getShapeType(result) !== 'solid' || !o.isValid(result) || !(o.getVolume(result) > 0 && o.getVolume(result) < o.getVolume(solid)))
        throw new Error('The blend did not sew into a valid closed solid.')
      return result
    } catch (error) { o.release(result); throw error }
  } finally { for (const h of owned.reverse()) o.release(h) }
}
