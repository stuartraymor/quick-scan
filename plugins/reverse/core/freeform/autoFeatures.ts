// SPDX-License-Identifier: AGPL-3.0-only
// Auto Freeform, Feature aligned: what the quads are told to follow.
//
// A field-aligned layout finds the part's directions by itself where they
// are plain; on a scan they are blurred by its noise, and the quads turn
// across a fillet or run skew to a cylinder as often as along it. Here the
// scan's directions of curvature are read at the size of the quads asked
// for — its normals evened over a fifth of a quad or so, the change of
// normal along each edge gathered as a tensor at each vertex and evened
// again — and where one direction bends far more than the other (a fillet,
// a cylinder, the rounded remains of a sharp edge) the straight direction
// is given to the layout as a constraint. A scan edge sharper than the hard
// edge angle gives its own direction, and its place.
//
// Pure typed-array code, for the worker.

import { scanTopology, type DirectionConstraint, type WorkMesh } from './autoPrepare'

/** How much more one direction must bend than the other, as |k1 − k2| / (|k1| + |k2|), for it to be given. */
const ANISOTROPY = 0.6
export const BALANCED_DETAIL_FACTOR = 2.19
/** The bend that counts: the stronger curvature times the quad's edge. 0.15 is a radius of about seven quads. */
const BEND = 0.15
/** The most evening passes, whatever the quad's size against the scan's triangles. */
const MAX_PASSES = 24

interface Adjacency {
  offsets: Int32Array
  list: Int32Array
}

function adjacencyOf(indices: Uint32Array, nv: number): Adjacency {
  const seen = new Set<number>()
  const degree = new Int32Array(nv + 1)
  const pairs: number[] = []
  for (let t = 0; t + 2 < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k], b = indices[t + ((k + 1) % 3)]
      if (a === b) continue
      const key = a < b ? a * nv + b : b * nv + a
      if (seen.has(key)) continue
      seen.add(key)
      pairs.push(a, b)
      degree[a + 1]++
      degree[b + 1]++
    }
  }
  for (let v = 0; v < nv; v++) degree[v + 1] += degree[v]
  const offsets = degree
  const fill = Int32Array.from(offsets.subarray(0, nv))
  const list = new Int32Array(pairs.length)
  for (let i = 0; i < pairs.length; i += 2) {
    list[fill[pairs[i]]++] = pairs[i + 1]
    list[fill[pairs[i + 1]]++] = pairs[i]
  }
  return { offsets, list }
}

function vertexNormals(m: WorkMesh): Float32Array {
  const p = m.positions
  const n = new Float32Array(p.length)
  for (let t = 0; t + 2 < m.indices.length; t += 3) {
    const a = m.indices[t] * 3, b = m.indices[t + 1] * 3, c = m.indices[t + 2] * 3
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    for (const o of [a, b, c]) {
      n[o] += nx
      n[o + 1] += ny
      n[o + 2] += nz
    }
  }
  normalise(n)
  return n
}

function normalise(n: Float32Array): void {
  for (let i = 0; i + 2 < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2])
    if (l > 0) {
      n[i] /= l
      n[i + 1] /= l
      n[i + 2] /= l
    }
  }
}

/** Each value averaged with its neighbours', `passes` times, `width` values a vertex. */
function even(values: Float32Array, width: number, adj: Adjacency, passes: number): Float32Array {
  let cur: Float32Array = values
  let next: Float32Array = new Float32Array(values.length)
  const nv = values.length / width
  for (let pass = 0; pass < passes; pass++) {
    for (let v = 0; v < nv; v++) {
      const a = adj.offsets[v], b = adj.offsets[v + 1]
      for (let k = 0; k < width; k++) {
        let s = cur[v * width + k]
        for (let i = a; i < b; i++) s += cur[adj.list[i] * width + k]
        next[v * width + k] = s / (b - a + 1)
      }
    }
    const swap: Float32Array = cur === values ? new Float32Array(values.length) : cur
    cur = next
    next = swap
  }
  return cur
}

export interface CurvatureField {
  /** Per vertex: the straighter direction (unit, in the tangent plane), xyz. */
  direction: Float32Array
  /** Per vertex: the two principal curvatures, the stronger first, 1/mm. */
  k: Float32Array
}

/** The scan's principal directions read at the size `scale`, mm: see the head of the file. */
export function curvatureField(m: WorkMesh, scale: number): CurvatureField {
  const p = m.positions
  const nv = p.length / 3
  const adj = adjacencyOf(m.indices, nv)
  let edge = 0, edges = 0
  for (let v = 0; v < nv; v++) {
    for (let i = adj.offsets[v]; i < adj.offsets[v + 1]; i++) {
      const w = adj.list[i]
      if (w < v) continue
      edge += Math.hypot(p[v * 3] - p[w * 3], p[v * 3 + 1] - p[w * 3 + 1], p[v * 3 + 2] - p[w * 3 + 2])
      edges++
    }
  }
  edge = edges > 0 ? edge / edges : scale
  // Averaging with the neighbours spreads over about edge·√passes.
  const passes = Math.min(MAX_PASSES, Math.max(1, Math.round(((0.2 * scale) / Math.max(edge, 1e-9)) ** 2)))
  const normals = even(vertexNormals(m), 3, adj, passes)
  normalise(normals)
  // The tensor Σ κ d̂ d̂ᵀ over a vertex's edges, six values: xx xy xz yy yz zz.
  const tensor = new Float32Array(nv * 6)
  for (let v = 0; v < nv; v++) {
    const a = adj.offsets[v], b = adj.offsets[v + 1]
    if (b === a) continue
    const nx = normals[v * 3], ny = normals[v * 3 + 1], nz = normals[v * 3 + 2]
    for (let i = a; i < b; i++) {
      const w = adj.list[i]
      let dx = p[w * 3] - p[v * 3], dy = p[w * 3 + 1] - p[v * 3 + 1], dz = p[w * 3 + 2] - p[v * 3 + 2]
      const off = dx * nx + dy * ny + dz * nz
      dx -= off * nx
      dy -= off * ny
      dz -= off * nz
      const l2 = dx * dx + dy * dy + dz * dz
      if (!(l2 > 0)) continue
      const kappa = ((normals[w * 3] - nx) * dx + (normals[w * 3 + 1] - ny) * dy + (normals[w * 3 + 2] - nz) * dz) / l2
      const s = kappa / l2 / (b - a)
      tensor[v * 6] += s * dx * dx
      tensor[v * 6 + 1] += s * dx * dy
      tensor[v * 6 + 2] += s * dx * dz
      tensor[v * 6 + 3] += s * dy * dy
      tensor[v * 6 + 4] += s * dy * dz
      tensor[v * 6 + 5] += s * dz * dz
    }
  }
  const t = even(tensor, 6, adj, Math.max(1, Math.round(passes / 2)))
  const direction = new Float32Array(nv * 3)
  const k = new Float32Array(nv * 2)
  for (let v = 0; v < nv; v++) {
    const nx = normals[v * 3], ny = normals[v * 3 + 1], nz = normals[v * 3 + 2]
    // A basis of the tangent plane.
    let ux: number, uy: number, uz: number
    if (Math.abs(nx) < 0.9) {
      ux = 0
      uy = -nz
      uz = ny
    } else {
      ux = nz
      uy = 0
      uz = -nx
    }
    const ul = Math.hypot(ux, uy, uz)
    if (!(ul > 0)) continue
    ux /= ul
    uy /= ul
    uz /= ul
    const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux
    const o = v * 6
    const tu = [t[o] * ux + t[o + 1] * uy + t[o + 2] * uz, t[o + 1] * ux + t[o + 3] * uy + t[o + 4] * uz, t[o + 2] * ux + t[o + 4] * uy + t[o + 5] * uz]
    const tv = [t[o] * vx + t[o + 1] * vy + t[o + 2] * vz, t[o + 1] * vx + t[o + 3] * vy + t[o + 4] * vz, t[o + 2] * vx + t[o + 4] * vy + t[o + 5] * vz]
    const a = ux * tu[0] + uy * tu[1] + uz * tu[2]
    const b = vx * tu[0] + vy * tu[1] + vz * tu[2]
    const c = vx * tv[0] + vy * tv[1] + vz * tv[2]
    // Eigenvalues of [[a, b], [b, c]]; the mean over directions of κ(θ) d̂ d̂ᵀ has (3k1 + k2)/8 and (k1 + 3k2)/8.
    const mean = (a + c) / 2
    const dev = Math.hypot((a - c) / 2, b)
    const e1 = mean + dev, e2 = mean - dev
    const k1 = 3 * e1 - e2, k2 = 3 * e2 - e1
    // The eigenvector of e1, as an angle in the basis.
    const angle = 0.5 * Math.atan2(2 * b, a - c)
    const c1 = Math.cos(angle), s1 = Math.sin(angle)
    const strong1 = Math.abs(k1) >= Math.abs(k2)
    // The straighter direction is the other principal one's.
    const ca = strong1 ? -s1 : c1, sa = strong1 ? c1 : s1
    direction[v * 3] = ca * ux + sa * vx
    direction[v * 3 + 1] = ca * uy + sa * vy
    direction[v * 3 + 2] = ca * uz + sa * vz
    k[v * 2] = strong1 ? k1 : k2
    k[v * 2 + 1] = strong1 ? k2 : k1
  }
  return { direction, k }
}

function visitBentEdges(m: WorkMesh, degrees: number, visit: (a: number, b: number, length: number, cosine: number) => void): void {
  const p = m.positions
  const nv = p.length / 3
  const nt = m.indices.length / 3
  const faceNormal = new Float32Array(nt * 3)
  for (let t = 0; t < nt; t++) {
    const a = m.indices[t * 3] * 3, b = m.indices[t * 3 + 1] * 3, c = m.indices[t * 3 + 2] * 3
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]
    faceNormal[t * 3] = uy * vz - uz * vy
    faceNormal[t * 3 + 1] = uz * vx - ux * vz
    faceNormal[t * 3 + 2] = ux * vy - uy * vx
  }
  normalise(faceNormal)
  const first = new Map<number, number>()
  const cos = Math.cos((degrees * Math.PI) / 180)
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const a = m.indices[t * 3 + k], b = m.indices[t * 3 + ((k + 1) % 3)]
      const key = a < b ? a * nv + b : b * nv + a
      const other = first.get(key)
      if (other === undefined) {
        first.set(key, t)
        continue
      }
      const dot = faceNormal[t * 3] * faceNormal[other * 3] + faceNormal[t * 3 + 1] * faceNormal[other * 3 + 1] + faceNormal[t * 3 + 2] * faceNormal[other * 3 + 2]
      if (dot >= cos) continue
      const dx = p[b * 3] - p[a * 3], dy = p[b * 3 + 1] - p[a * 3 + 1], dz = p[b * 3 + 2] - p[a * 3 + 2]
      const l = Math.hypot(dx, dy, dz)
      if (!(l > 0)) continue
      visit(a, b, l, Math.max(-1, Math.min(1, dot)))
    }
  }
}

/** Estimate extra cells from integrated bends and open rims. Both lengths are
 * normalized by the square root of area, independent of the mesh's units. */
export function featureDetailWeight(mesh: WorkMesh, area: number, target = 2000, topology = scanTopology(mesh)): number {
  const lengthScale = Math.sqrt(area)
  const threshold = Math.PI / 9
  let bend = 0, excess = 0, sharpLength = 0
  visitBentEdges(mesh, 0, (_a, _b, length, cosine) => {
    const angle = Math.acos(cosine)
    bend += length * angle
    excess += length * Math.max(0, angle - threshold)
    if (angle > Math.PI / 4) sharpLength += length
  })
  const ridge = Math.sqrt(excess / lengthScale)
  if (sharpLength < lengthScale * 1e-4) {
    // On smooth forms a specified curvature sampling density becomes redundant
    // as the ordinary grid resolves the bends. Combine the two resolutions.
    // The integral of edge length times exterior angle on a sphere, divided
    // by sqrt(area), tends to 4 sqrt(pi). A fine STL or OBJ seam can remain
    // open at floating-point precision even on an otherwise smooth sphere.
    const gentle = bend / lengthScale <= 1.05 * 4 * Math.sqrt(Math.PI)
    if (ridge < 0.1 && (gentle || (topology.closed && topology.euler === 2))) return 0
    const rows = 1.6 * bend / lengthScale + 9 * ridge
    const curvatureCells = rows * rows
    return Math.hypot(target, curvatureCells) / target - 1
  }
  const detail = Math.min(1.5, ridge)
  if (topology.closed && topology.euler === 2) {
    // Localized details of a simply connected shell have a finite cell budget.
    return detail * 800 / (target + 150)
  }
  const rim = Math.max(0, topology.boundaryLength / lengthScale - 4)
  const cycles = Math.max(0, 1 - topology.euler)
  const rimCells = rim > 0 && cycles > 0
    ? 5 * rim * Math.sqrt(Math.min(2000, target)) + 16 * cycles * Math.sqrt(target / 1000)
    : 0
  // Few long rims (e.g. thin blades) need extra rows at coarse resolution.
  // At fine resolution the ordinary rows already follow most of these rims.
  const sparseRim = cycles > 0 && cycles < Math.sqrt(target) ? Math.max(0, rim - 1) : 0
  const coarseRimCells = 12 * Math.sqrt(2000) * sparseRim * Math.max(-0.75, (2000-target)/2000) / 3
  const extra = detail * 4000 / (2000 + target) + (rimCells + coarseRimCells) / target
  // On highly perforated sheets, dropping below the topology allowance can
  // omit fine strips even when the requested number of cells has been met.
  const topologyFloor = cycles > target / 12 ? Math.max(0, 44 * cycles / target - 1) / (BALANCED_DETAIL_FACTOR - 1) : 0
  return Math.max(0, extra, topologyFloor)
}

export function hardEdgeConstraints(m: WorkMesh, degrees: number): DirectionConstraint[] {
  const p = m.positions
  const out = new Map<number, DirectionConstraint>()
  visitBentEdges(m, degrees, (a, b, length) => {
    const direction: [number, number, number] = [0, 1, 2].map(k => (p[3*b+k] - p[3*a+k]) / length) as [number, number, number]
    for (const v of [a, b]) {
      if (!out.has(v)) out.set(v, { vertex: v, direction, position: [p[v*3], p[v*3+1], p[v*3+2]], weight: 1 })
    }
  })
  return [...out.values()]
}

/** What Feature aligned gives the layout: the hard edges, and the straighter direction wherever the scan bends one way far more than the other. */
export function featureConstraints(m: WorkMesh, scale: number, hardEdgeDegrees: number, tune: { anisotropy?: number; bend?: number; hard?: boolean; curvature?: boolean } = {}): DirectionConstraint[] {
  const hard = tune.hard === false ? [] : hardEdgeConstraints(m, hardEdgeDegrees)
  const nv = m.positions.length / 3
  // A scan whose triangles are sharp against each other everywhere is noise, not edges: its edges are not given.
  const out: DirectionConstraint[] = hard.length <= 0.25 * nv ? hard : []
  const taken = new Set(out.map((c) => c.vertex))
  if (tune.curvature === false) return out
  const minAnisotropy = tune.anisotropy ?? ANISOTROPY
  const minBend = tune.bend ?? BEND
  const f = curvatureField(m, scale)
  for (let v = 0; v < nv; v++) {
    if (taken.has(v)) continue
    const k1 = f.k[v * 2], k2 = f.k[v * 2 + 1]
    const size = Math.abs(k1) + Math.abs(k2)
    if (!(size > 0)) continue
    const anisotropy = Math.abs(k1 - k2) / size
    const bend = Math.abs(k1) * scale
    if (anisotropy < minAnisotropy || bend < minBend) continue
    const d: [number, number, number] = [f.direction[v * 3], f.direction[v * 3 + 1], f.direction[v * 3 + 2]]
    if (!(Math.hypot(d[0], d[1], d[2]) > 0.5)) continue
    out.push({ vertex: v, direction: d, weight: Math.min(1, anisotropy * Math.min(1, bend)) })
  }
  return out
}
