// SPDX-License-Identifier: AGPL-3.0-only
/** Unique cage edges for the preview overlay; no tessellation diagonals. */
export function cageLines(positions: ArrayLike<number>, faces: readonly (readonly number[])[]): Float32Array {
  const edges = new Set<string>(), result: number[] = []
  for (const face of faces) for (let i = 0; i < face.length; i++) {
    const a = face[i], b = face[(i + 1) % face.length]
    if (a === b) continue
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || 3 * Math.max(a, b) + 2 >= positions.length) throw new Error('Cage edge references an invalid vertex.')
    const key = a < b ? `${a}:${b}` : `${b}:${a}`
    if (edges.has(key)) continue
    edges.add(key)
    for (const v of [a, b]) for (let axis = 0; axis < 3; axis++) {
      const value = positions[3 * v + axis]
      if (!Number.isFinite(value)) throw new Error('Cage edge has a non-finite coordinate.')
      result.push(value)
    }
  }
  return new Float32Array(result)
}
