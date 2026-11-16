// SPDX-License-Identifier: AGPL-3.0-only
export interface MeasuredTriangles {
  positions: Float32Array
  triangles: Uint32Array
  values: Float32Array
}

/** Refine the measured scalar field on the existing CAD tessellation.
 * A flat CAD triangle can span a curved scan: geometric chord accuracy alone
 * does not bound the error of interpolating its signed deviation colors.
 * Probe shared edge midpoints and centroids, then split conformingly where
 * the measured value differs from the interpolant within the legend range.
 * Positions stay on the input facets; this never moves the CAD/control net.
 * The budgets bound work, not a continuous maximum-error guarantee. */
export function refineDeviation(input: MeasuredTriangles, measure: (p: Float32Array) => Float32Array,
  tolerance: number, maxSamples = 200_000, maxPasses = 6): MeasuredTriangles {
  if (!(Number.isFinite(tolerance) && tolerance > 0)) throw new Error('Invalid deviation tolerance.')
  let data = input
  const clipped = (v: number) => Math.max(-5 * tolerance, Math.min(5 * tolerance, v))
  const differs = (measured: number, interpolated: number) => Math.abs(clipped(measured) - clipped(interpolated)) > tolerance * .02
  for (let pass = 0; pass < maxPasses; pass++) {
    const { positions, triangles, values } = data, count = positions.length / 3
    if (count + triangles.length * 4 / 3 > maxSamples) break
    const probes: number[] = [], edges = new Map<string, number>(), pairs: [number, number][] = []
    const key = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`
    const edge = (a: number, b: number) => {
      const k = key(a, b), old = edges.get(k)
      if (old !== undefined) return old
      const index = probes.length / 3
      for (let axis = 0; axis < 3; axis++) probes.push((positions[a * 3 + axis] + positions[b * 3 + axis]) / 2)
      pairs.push([a, b]); edges.set(k, index)
      return index
    }
    // Allocate all edge probes first, so their indices match the pair list.
    for (let i = 0; i < triangles.length; i += 3) {
      const [a, b, c] = triangles.subarray(i, i + 3)
      edge(a, b); edge(b, c); edge(c, a)
    }
    const centreStart = pairs.length
    for (let i = 0; i < triangles.length; i += 3) for (let axis = 0; axis < 3; axis++) {
      probes.push((positions[3 * triangles[i] + axis] + positions[3 * triangles[i + 1] + axis] + positions[3 * triangles[i + 2] + axis]) / 3)
    }
    const samplePositions = Float32Array.from(probes), sampled = measure(samplePositions)
    if (sampled.length !== probes.length / 3 || !sampled.every(Number.isFinite)) throw new Error('Incomplete deviation correspondence.')
    const split = new Set<number>()
    for (let i = 0; i < triangles.length; i += 3) {
      const [a, b, c] = triangles.subarray(i, i + 3), ab = edges.get(key(a, b))!, bc = edges.get(key(b, c))!, ca = edges.get(key(c, a))!
      if (differs(sampled[ab], (values[a] + values[b]) / 2) || differs(sampled[bc], (values[b] + values[c]) / 2) ||
          differs(sampled[ca], (values[c] + values[a]) / 2) || differs(sampled[centreStart + i / 3], (values[a] + values[b] + values[c]) / 3)) {
        split.add(ab); split.add(bc); split.add(ca)
      }
    }
    if (!split.size) break
    const nextPositions = new Float32Array(positions.length + split.size * 3), nextValues = new Float32Array(count + split.size)
    nextPositions.set(positions); nextValues.set(values)
    const added = new Map<number, number>()
    for (const probe of split) {
      const v = count + added.size
      added.set(probe, v); nextPositions.set(samplePositions.subarray(probe * 3, probe * 3 + 3), v * 3); nextValues[v] = sampled[probe]
    }
    const next: number[] = []
    for (let i = 0; i < triangles.length; i += 3) {
      const v = Array.from(triangles.subarray(i, i + 3)), m = v.map((a, j) => added.get(edges.get(key(a, v[(j + 1) % 3]))!))
      const n = m.filter(x => x !== undefined).length
      if (n === 0) { next.push(...v); continue }
      if (n === 3) { next.push(v[0], m[0]!, m[2]!, m[0]!, v[1], m[1]!, m[2]!, m[1]!, v[2], m[0]!, m[1]!, m[2]!); continue }
      // Rotate to the one split edge, or the first of two consecutive ones.
      const j = n === 1 ? m.findIndex(x => x !== undefined) : m.findIndex((x, j) => x !== undefined && m[(j + 1) % 3] !== undefined)
      const a = v[j], b = v[(j + 1) % 3], c = v[(j + 2) % 3], ab = m[j]!
      if (n === 1) next.push(a, ab, c, ab, b, c)
      else { const bc = m[(j + 1) % 3]!; next.push(ab, b, bc, a, ab, c, ab, bc, c) }
    }
    data = { positions: nextPositions, triangles: Uint32Array.from(next), values: nextValues }
  }
  return data
}
