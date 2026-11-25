// SPDX-License-Identifier: AGPL-3.0-only
// Part of a TypeScript port of Instant Meshes ("Instant Field-Aligned Meshes").
// Copyright (c) 2015 Wenzel Jakob, Daniele Panozzo, Marco Tarini, and Olga Sorkine-Hornung
// (BSD-3-Clause; the licence text is in ATTRIBUTION.md).
//
// The last step, which stands where cleanup.cpp (remove_nonmanifold) stands
// in the original but is not a port of it: what the rest of Quick Scan needs
// of a cage. Faces with a repeated vertex go; of the faces around an edge
// that more than two share, the two of the largest pieces stay; the faces
// are wound alike, outwards; a vertex where two fans only touch is split;
// crumbs (pieces of under one per cent of the faces) and unused vertices go.

export interface CleanMesh {
  positions: Float64Array
  faces: number[][]
  boundaryEdges: number
  irregular: number
  components: number
}

const KEY = 0x4000000

function find(parent: Int32Array, x: number): number {
  while (parent[x] !== x) {
    parent[x] = parent[parent[x]]
    x = parent[x]
  }
  return x
}

/** Edge → the corners (4·face + side) that lie on it, as a linked list per edge. */
function edgeCorners(quads: Uint32Array, alive: Uint8Array, nQ: number): { head: Map<number, number>; next: Int32Array } {
  const head = new Map<number, number>()
  const next = new Int32Array(nQ * 4).fill(-1)
  for (let q = nQ - 1; q >= 0; q--) {
    if (!alive[q]) continue
    for (let k = 3; k >= 0; k--) {
      const a = quads[4 * q + k], b = quads[4 * q + (k + 1) % 4]
      const key = a < b ? a * KEY + b : b * KEY + a
      const h = head.get(key)
      if (h !== undefined) next[4 * q + k] = h
      head.set(key, 4 * q + k)
    }
  }
  return { head, next }
}

export function cleanQuads(positions: Float64Array, normals: Float64Array, quadsIn: Uint32Array, nVIn: number): CleanMesh {
  const quads = quadsIn.slice()
  const nQ = quads.length / 4
  let nV = nVIn
  const alive = new Uint8Array(nQ).fill(1)

  // 1. Faces with a repeated vertex.
  for (let q = 0; q < nQ; q++) {
    const a = quads[4 * q], b = quads[4 * q + 1], c = quads[4 * q + 2], d = quads[4 * q + 3]
    if (a === b || a === c || a === d || b === c || b === d || c === d) alive[q] = 0
  }

  // 2. Edges shared by more than two faces: keep the two faces of the largest pieces.
  for (let round = 0; round < 16; round++) {
    const { head, next } = edgeCorners(quads, alive, nQ)
    const parent = new Int32Array(nQ)
    for (let q = 0; q < nQ; q++) parent[q] = q
    let bad = false
    for (const h of head.values()) {
      const second = next[h]
      if (second < 0) continue
      if (next[second] >= 0) { bad = true; continue }
      const a = find(parent, h >> 2), b = find(parent, second >> 2)
      if (a !== b) parent[a < b ? b : a] = a < b ? a : b
    }
    if (!bad) break
    const size = new Int32Array(nQ)
    for (let q = 0; q < nQ; q++) if (alive[q]) size[find(parent, q)]++
    for (const h of head.values()) {
      if (next[h] < 0 || next[next[h]] < 0) continue
      const around: number[] = []
      for (let c = h; c >= 0; c = next[c]) if (!around.includes(c >> 2)) around.push(c >> 2)
      around.sort((x, y) => size[find(parent, y)] - size[find(parent, x)] || x - y)
      for (let k = 2; k < around.length; k++) alive[around[k]] = 0
    }
  }

  // 3. Wind the faces alike across shared edges, then each piece outwards (along the vertex normals).
  {
    const { head, next } = edgeCorners(quads, alive, nQ)
    const mate = new Int32Array(nQ * 4).fill(-1)
    for (const h of head.values()) {
      const second = next[h]
      if (second < 0) continue
      mate[h] = second
      mate[second] = h
    }
    const state = new Int8Array(nQ) // 0 unseen, 1 kept, -1 flipped
    const stack: number[] = []
    const flip = (q: number): void => {
      const b = quads[4 * q + 1]
      quads[4 * q + 1] = quads[4 * q + 3]
      quads[4 * q + 3] = b
    }
    const along = (q: number): number => {
      // Newell normal of the quad against the sum of its vertices' normals.
      let nx = 0, ny = 0, nz = 0, sx = 0, sy = 0, sz = 0
      for (let k = 0; k < 4; k++) {
        const a = 3 * quads[4 * q + k], b = 3 * quads[4 * q + (k + 1) % 4]
        nx += (positions[a + 1] - positions[b + 1]) * (positions[a + 2] + positions[b + 2])
        ny += (positions[a + 2] - positions[b + 2]) * (positions[a] + positions[b])
        nz += (positions[a] - positions[b]) * (positions[a + 1] + positions[b + 1])
        sx += normals[a]; sy += normals[a + 1]; sz += normals[a + 2]
      }
      return nx * sx + ny * sy + nz * sz
    }
    for (let seed = 0; seed < nQ; seed++) {
      if (!alive[seed] || state[seed] !== 0) continue
      const piece: number[] = []
      state[seed] = 1
      stack.push(seed)
      while (stack.length > 0) {
        const q = stack.pop()!
        piece.push(q)
        for (let k = 0; k < 4; k++) {
          const m = mate[4 * q + k]
          if (m < 0) continue
          const other = m >> 2
          if (state[other] !== 0) continue
          // Alike when the shared edge runs opposite ways in the two faces.
          const a = quadsIn[4 * q + k], oa = quadsIn[m]
          const sameDirection = a === oa
          state[other] = sameDirection ? -state[q] : state[q]
          stack.push(other)
        }
      }
      for (const q of piece) if (state[q] < 0) flip(q)
      let sum = 0
      for (const q of piece) sum += along(q)
      if (sum < 0) for (const q of piece) flip(q)
    }
  }

  // 4. Split a vertex where fans of faces only touch.
  {
    const count = new Int32Array(nV + 1)
    for (let q = 0; q < nQ; q++) if (alive[q]) for (let k = 0; k < 4; k++) count[quads[4 * q + k] + 1]++
    for (let v = 0; v < nV; v++) count[v + 1] += count[v]
    const fill = count.slice(0, nV)
    const corners = new Int32Array(count[nV])
    for (let q = 0; q < nQ; q++) if (alive[q]) for (let k = 0; k < 4; k++) corners[fill[quads[4 * q + k]]++] = 4 * q + k
    const extra: number[] = []
    const originalNV = nV
    for (let v = 0; v < originalNV; v++) {
      const b = count[v], e = count[v + 1], m = e - b
      if (m < 2) continue
      const group = new Int32Array(m)
      for (let k = 0; k < m; k++) group[k] = k
      const seen = new Map<number, number>()
      for (let k = 0; k < m; k++) {
        const c = corners[b + k], q = c >> 2, s = c & 3
        for (const w of [quads[4 * q + (s + 1) % 4], quads[4 * q + (s + 3) % 4]]) {
          const other = seen.get(w)
          if (other === undefined) seen.set(w, k)
          else {
            const x = find(group, k), y = find(group, other)
            if (x !== y) group[x < y ? y : x] = x < y ? x : y
          }
        }
      }
      const sizes = new Map<number, number>()
      for (let k = 0; k < m; k++) { const g = find(group, k); sizes.set(g, (sizes.get(g) ?? 0) + 1) }
      if (sizes.size < 2) continue
      let keep = -1, keepSize = -1
      for (const [g, s] of sizes) if (s > keepSize) { keep = g; keepSize = s }
      const copies = new Map<number, number>()
      for (let k = 0; k < m; k++) {
        const g = find(group, k)
        if (g === keep) continue
        let copy = copies.get(g)
        if (copy === undefined) {
          copy = nV++
          copies.set(g, copy)
          extra.push(v)
        }
        quads[corners[b + k]] = copy
      }
    }
    if (extra.length > 0) {
      const grown = new Float64Array(nV * 3)
      grown.set(positions.subarray(0, originalNV * 3))
      for (let k = 0; k < extra.length; k++) {
        const from = 3 * extra[k], to = 3 * (originalNV + k)
        grown[to] = positions[from]; grown[to + 1] = positions[from + 1]; grown[to + 2] = positions[from + 2]
      }
      positions = grown
    }
  }

  // 5. Pieces, and the crumbs among them.
  const parent = new Int32Array(nV)
  for (let v = 0; v < nV; v++) parent[v] = v
  let nAlive = 0
  for (let q = 0; q < nQ; q++) {
    if (!alive[q]) continue
    nAlive++
    const a = find(parent, quads[4 * q])
    for (let k = 1; k < 4; k++) {
      const b = find(parent, quads[4 * q + k])
      if (a !== b) parent[b] = a
    }
  }
  const pieceFaces = new Map<number, number>()
  for (let q = 0; q < nQ; q++) if (alive[q]) { const r = find(parent, quads[4 * q]); pieceFaces.set(r, (pieceFaces.get(r) ?? 0) + 1) }
  let largest = 0
  for (const s of pieceFaces.values()) if (s > largest) largest = s
  let components = 0
  const crumb = Math.max(1, nAlive * 0.01)
  const dropped = new Set<number>()
  for (const [r, s] of pieceFaces) {
    if (s < crumb && s < largest) dropped.add(r)
    else components++
  }
  if (dropped.size > 0) for (let q = 0; q < nQ; q++) if (alive[q] && dropped.has(find(parent, quads[4 * q]))) alive[q] = 0

  // 6. Compact, and count.
  const remap = new Int32Array(nV).fill(-1)
  const faces: number[][] = []
  let used = 0
  for (let q = 0; q < nQ; q++) {
    if (!alive[q]) continue
    const face: number[] = []
    for (let k = 0; k < 4; k++) {
      const v = quads[4 * q + k]
      if (remap[v] < 0) remap[v] = used++
      face.push(remap[v])
    }
    faces.push(face)
  }
  const out = new Float64Array(used * 3)
  for (let v = 0; v < nV; v++) {
    const r = remap[v]
    if (r < 0) continue
    out[3 * r] = positions[3 * v]; out[3 * r + 1] = positions[3 * v + 1]; out[3 * r + 2] = positions[3 * v + 2]
  }
  const edges = new Map<number, number>()
  for (const f of faces) {
    for (let k = 0; k < 4; k++) {
      const a = f[k], b = f[(k + 1) % 4]
      const key = a < b ? a * KEY + b : b * KEY + a
      edges.set(key, (edges.get(key) ?? 0) + 1)
    }
  }
  const valence = new Int32Array(used), rim = new Uint8Array(used)
  let boundaryEdges = 0
  for (const [key, c] of edges) {
    const a = Math.floor(key / KEY), b = key % KEY
    valence[a]++
    valence[b]++
    if (c === 1) { boundaryEdges++; rim[a] = 1; rim[b] = 1 }
  }
  let irregular = 0
  for (let v = 0; v < used; v++) if (!rim[v] && valence[v] !== 4) irregular++
  return { positions: out, faces, boundaryEdges, irregular, components }
}
