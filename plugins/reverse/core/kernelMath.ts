// SPDX-License-Identifier: AGPL-3.0-only
// The kernel's arithmetic outside the package: points and turns, whether two
// surfaces are one, face histories parsed and composed, a circle through
// three points, and what kind a face or an edge is.

import type { Vec3 } from '../../../src/core/types'
import { add, cross, dot, len, normalize, scale, sub } from '../../../src/core/vec'
import type { FaceHistory, RawFace } from './kernelTypes'
import type { OcctLike, XYZ } from './occtTypes'
import type { EdgeKind, FaceKind } from './topo'

/**
 * OCCT's default length quadrature changes slightly when a closed ellipse
 * is split into arcs. Integrate the analytic speed over the actual edge range
 * so a trim seam and the corresponding face perimeters agree across STEP files.
 */
export function cadEdgeLength(o: Pick<OcctLike, 'curveType' | 'curveLength' | 'curveParameters' | 'curvePointAtParam'>, edge: number, type = o.curveType(edge)): number {
  if (type !== 'ellipse') return o.curveLength(edge)
  const { first, last } = o.curveParameters(edge)
  // OCCT parameterizes an ellipse as C + A cos(t) + B sin(t), with A and B
  // orthogonal. Diametrically opposite points on its carrier give their lengths.
  const diameter = (t: number) => len(sub(vec(o.curvePointAtParam(edge, t)), vec(o.curvePointAtParam(edge, t + Math.PI))))
  const major = diameter(0) / 2
  const minor = diameter(Math.PI / 2) / 2
  const speed = (t: number) => Math.hypot(major * Math.sin(t), minor * Math.cos(t))
  const integrate = (a: number, b: number, fa: number, fm: number, fb: number, tol: number, depth: number): number => {
    const m = (a + b) / 2
    const fl = speed((a + m) / 2), fr = speed((m + b) / 2)
    const coarse = (b - a) * (fa + 4 * fm + fb) / 6
    const fine = (b - a) * (fa + 4 * fl + 2 * fm + 4 * fr + fb) / 12
    const correction = (fine - coarse) / 15
    if (Math.abs(correction) <= tol || depth === 0) return fine + correction
    return integrate(a, m, fa, fl, fm, tol / 2, depth - 1) + integrate(m, b, fm, fr, fb, tol / 2, depth - 1)
  }
  // Split at the extrema first, including arcs whose parameter wraps past 2π.
  const quadrant = Math.PI / 2
  let start = first, length = 0
  for (let i = Math.floor(first / quadrant) + 1; start < last; i++) {
    const end = Math.min(last, i * quadrant)
    length += integrate(start, end, speed(start), speed((start + end) / 2), speed(end), (end - start) * major * 1e-12, 20)
    start = end
  }
  return length
}

/** A part's name as a file gives it, or undefined where it says nothing: a
 *  blank, a bare number, an instance tag a CAD system writes for a
 *  component nobody named. */
export function partName(name: string): string | undefined {
  const n = name.trim()
  return n === '' || /^\d+$/.test(n) || /^NAUO\d*$/i.test(n) || n.startsWith('=>') ? undefined : n
}

/** A #rgb or #rrggbb colour as the kernel takes it — linear 0–1 channels,
 *  which it writes into the STEP file as sRGB again, the #rrggbb given —
 *  or undefined for anything else. */
export function stepColor(hex: string | undefined): [number, number, number] | undefined {
  const m = hex ? /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim()) : null
  if (!m) return undefined
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]
  const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return [0, 2, 4].map((i) => linear(parseInt(h.slice(i, i + 2), 16) / 255)) as [number, number, number]
}

export const xyz = (v: Vec3): XYZ => ({ x: v[0], y: v[1], z: v[2] })

export const vec = (p: XYZ): Vec3 => [p.x, p.y, p.z]

/** The turn about an axis through the origin that carries a unit
 *  direction onto +Z — null when it lies there already. A direction along
 *  −Z is turned about X. */
export function turnOntoZ(dir: Vec3): { axis: Vec3; angle: number } | null {
  const angle = Math.acos(Math.max(-1, Math.min(1, dir[2])))
  if (angle < 1e-9) return null
  const axis = normalize(cross(dir, [0, 0, 1])) ?? [1, 0, 0]
  return { axis, angle }
}

/** A vector turned about a unit axis through the origin (Rodrigues). */
export function rotateVec(v: Vec3, turn: { axis: Vec3; angle: number }): Vec3 {
  const { axis, angle } = turn
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const k = cross(axis, v)
  const d = dot(axis, v) * (1 - c)
  return [v[0] * c + k[0] * s + axis[0] * d, v[1] * c + k[1] * s + axis[1] * d, v[2] * c + k[2] * s + axis[2] * d]
}

/** The kernel's flat history — groups of an old hash, a count, and that
 *  many new hashes — as a map. */
/** The face among `candidates` lying on the same surface as `was` — the
 *  same plane, the same cylinder — nearest to where it was: how a face is
 *  found again on a body whose neighbouring rounds were taken off, which
 *  changes its outline and its hash and leaves its surface alone. */
export function sameSurface(was: RawFace, candidates: readonly RawFace[]): RawFace | null {
  let best: RawFace | null = null
  let bestD = Infinity
  for (const f of candidates) {
    if (f.kind !== was.kind) continue
    if (was.kind === 'plane') {
      if (dot(f.dir, was.dir) < 1 - 1e-6) continue
      if (Math.abs(dot(sub(f.centroid, was.centroid), was.dir)) > 1e-4) continue
    } else {
      if (Math.abs(dot(f.dir, was.dir)) < 1 - 1e-6) continue
      if (was.radius !== undefined && (f.radius === undefined || Math.abs(f.radius - was.radius) > 1e-4)) continue
      if (was.center && f.center) {
        const off = sub(f.center, was.center)
        const along = dot(off, was.dir)
        const across = sub(off, scale(was.dir, along))
        // A sphere's centre is a point; an axis may be read anywhere along it.
        if (Math.hypot(across[0], across[1], across[2]) > 1e-4 || (was.kind === 'sphere' && Math.abs(along) > 1e-4)) continue
      }
    }
    const d = sub(f.centroid, was.centroid)
    const dist = Math.hypot(d[0], d[1], d[2])
    if (dist < bestD) {
      bestD = dist
      best = f
    }
  }
  return best
}

/** Two operations' histories as one: what each old face became after the
 *  first and then the second. A face the first left alone and the second
 *  changed is the second's to tell. */
export function composeHistory(first: FaceHistory, then: FaceHistory): FaceHistory {
  const out: FaceHistory = new Map()
  for (const [old, made] of first) out.set(old, made.flatMap((h) => then.get(h) ?? [h]))
  for (const [old, made] of then) if (!out.has(old)) out.set(old, made)
  return out
}

export function parseHistory(flat: readonly number[]): FaceHistory {
  const out: FaceHistory = new Map()
  for (let i = 0; i + 1 < flat.length; ) {
    const old = flat[i]
    const n = flat[i + 1]
    out.set(old, flat.slice(i + 2, i + 2 + n))
    i += 2 + n
  }
  return out
}

/** The circle through three points: centre, radius and axis, or null when
 *  they are in a line. */
export function circleThrough(a: Vec3, b: Vec3, c: Vec3): { center: Vec3; radius: number; axis: Vec3 } | null {
  const ab = sub(b, a)
  const ac = sub(c, a)
  const n = cross(ab, ac)
  const nn = dot(n, n)
  if (nn < 1e-18) return null
  // The circumcentre in the plane of the three, by the standard formula.
  const t = scale(sub(scale(cross(n, ab), dot(ac, ac)), scale(cross(n, ac), dot(ab, ab))), 1 / (2 * nn))
  const center = add(a, t)
  return { center, radius: len(t), axis: normalize(n) ?? [0, 0, 1] }
}

/** The kind of surface a kernel name stands for. */
export function faceKindOf(type: string): FaceKind {
  return type === 'plane' || type === 'cylinder' || type === 'cone' || type === 'sphere' || type === 'torus' ? type : 'other'
}

export function edgeKindOf(type: string): EdgeKind {
  return type === 'line' || type === 'circle' ? type : 'other'
}
