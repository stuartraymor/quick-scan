// SPDX-License-Identifier: AGPL-3.0-only
/** Vertex numbers carried through an edit's map — each old vertex's new
 *  number, −1 for one that went — those that went left out. */
export function remapVertices(vertices: Uint32Array, map: Int32Array): Uint32Array {
  const out: number[] = []
  for (const v of vertices) {
    const to = v < map.length ? map[v] : -1
    if (to >= 0) out.push(to)
  }
  return Uint32Array.from(out)
}
