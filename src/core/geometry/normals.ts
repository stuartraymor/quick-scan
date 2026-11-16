// SPDX-License-Identifier: AGPL-3.0-only
// Vertex normals for a freshly read mesh, and the one correction a file's
// winding may need: a part exported inside-out is turned the right way out,
// normals and triangles together, because alignment and wall thickness both
// go by which way the surface faces.

import { extentOf } from './bounds'
import { tetraVolume6 } from './centroid'
import { buildAdjacency } from './adjacency'

/** Area-weighted per-vertex normals (unnormalized cross products summed,
 *  then normalized). Orientation follows the triangle winding — see
 *  `orientNormalsOutward` for how an inside-out mesh is put right. */
export function computeVertexNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length)
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3
    const b = indices[t + 1] * 3
    const c = indices[t + 2] * 3
    const abx = positions[b] - positions[a]
    const aby = positions[b + 1] - positions[a + 1]
    const abz = positions[b + 2] - positions[a + 2]
    const acx = positions[c] - positions[a]
    const acy = positions[c + 1] - positions[a + 1]
    const acz = positions[c + 2] - positions[a + 2]
    const nx = aby * acz - abz * acy
    const ny = abz * acx - abx * acz
    const nz = abx * acy - aby * acx
    normals[a] += nx
    normals[a + 1] += ny
    normals[a + 2] += nz
    normals[b] += nx
    normals[b + 1] += ny
    normals[b + 2] += nz
    normals[c] += nx
    normals[c + 1] += ny
    normals[c + 2] += nz
  }
  for (let v = 0; v < normals.length; v += 3) {
    const len = Math.sqrt(normals[v] ** 2 + normals[v + 1] ** 2 + normals[v + 2] ** 2)
    if (len > 1e-20) {
      normals[v] /= len
      normals[v + 1] /= len
      normals[v + 2] /= len
    } else {
      normals[v + 2] = 1
    }
  }
  return normals
}

/**
 * Put an inside-out mesh right, in place: flip every normal and reverse every
 * triangle's winding when the winding decisively encloses its volume
 * inside-out. The alignment code matches surfaces by the *signed* dot of scan
 * and nominal normals, and wall thickness casts into the material along them,
 * so an STL exported with reversed winding would silently fail both.
 *
 * The winding must turn with the normals: the viewer draws the scan
 * double-sided, and for double-sided materials three.js takes the lit side
 * from gl_FrontFacing — the winding — negating the vertex normal on back
 * faces. Corrected normals over uncorrected winding would therefore be
 * negated right back on every visible fragment, leaving the whole part lit
 * from behind (uniformly dark, ambient only).
 *
 * The test is the signed volume about the centroid: origin-independent for a
 * closed mesh. A curved open sheet can give a strong but meaningless volume
 * signal, reversing its snapping normals and tolerance colors. Require two
 * incident triangles on every edge before using that signal. Open or
 * nonmanifold scans retain their input winding, as does an explicit
 * keep-winding file (see parsers/ply).
 */
export function orientNormalsOutward(
  positions: Float32Array,
  indices: Uint32Array,
  normals: Float32Array,
  adjacency?: { offsets: Uint32Array; list: Uint32Array },
): boolean {
  const vcount = positions.length / 3
  if (vcount === 0) return false
  let cx = 0, cy = 0, cz = 0
  for (let v = 0; v < positions.length; v += 3) {
    cx += positions[v]; cy += positions[v + 1]; cz += positions[v + 2]
  }
  const { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] } = extentOf(positions)
  cx /= vcount; cy /= vcount; cz /= vcount

  let vol6 = 0
  const centre: [number, number, number] = [cx, cy, cz]
  for (let t = 0; t < indices.length; t += 3) vol6 += tetraVolume6(positions, indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3, centre)

  const bboxVol = (maxX - minX) * (maxY - minY) * (maxZ - minZ)
  // Decisive means the enclosed volume is a real fraction of the bounding box;
  // below that the mesh is a sheet and its orientation is not knowable.
  if (!(bboxVol > 0) || vol6 >= -6e-3 * bboxVol) return false
  // Reuse the graph's bounded CSR storage; do not allocate a global edge
  // map (large scans can exceed V8's Map entry limit). Each adjacent vertex
  // occurs once per incident triangle, so a closed manifold edge occurs twice.
  const { offsets, list } = adjacency ?? buildAdjacency(indices, vcount)
  const uses = new Map<number, number>()
  for (let v = 0; v < vcount; v++) {
    uses.clear()
    for (let i = offsets[v]; i < offsets[v + 1]; i++) uses.set(list[i], (uses.get(list[i]) ?? 0) + 1)
    for (const count of uses.values()) if (count !== 2) return false
  }
  for (let v = 0; v < normals.length; v++) normals[v] = -normals[v]
  for (let t = 0; t < indices.length; t += 3) {
    const tmp = indices[t + 1]
    indices[t + 1] = indices[t + 2]
    indices[t + 2] = tmp
  }
  return true
}
