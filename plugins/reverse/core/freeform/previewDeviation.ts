// SPDX-License-Identifier: AGPL-3.0-only
import { pointValueCache } from './pointValueCache'
import { emptyHit, NominalSurface } from '../../../../src/core/deviation/surface'

/** Signed distance at surface vertices, relative to the reference scan winding. */
export function previewDeviation(positions: Float32Array, scan: NominalSurface): Float32Array {
  if (positions.length % 3) throw new Error('Surface positions must contain XYZ triples.')
  const values = new Float32Array(positions.length / 3), hit = emptyHit()
  for (let i = 0; i < values.length; i++) {
    const x = positions[3*i], y = positions[3*i+1], z = positions[3*i+2]
    values[i] = Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) && scan.closest(x, y, z, hit) ? hit.signed : NaN
  }
  return values
}

/** One reference scan owns this bounded cache. Geometry revisions reuse only
 * exactly identical Float32 coordinates; tolerances never enter the cache key.
 * A changed scan must get a new sampler (including a winding/transform change).
 */
export function deviationSampler(scan: NominalSurface, capacity = 200_000): (positions: Float32Array) => Float32Array {
  if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Invalid deviation cache capacity.')
  const cache = pointValueCache(capacity)
  const hit = emptyHit()
  return positions => {
    if (positions.length % 3) throw new Error('Surface positions must contain XYZ triples.')
    const values = new Float32Array(positions.length / 3)
    const bits = new Uint32Array(positions.buffer, positions.byteOffset, positions.length)
    for (let i = 0; i < values.length; i++) {
      const x = positions[i*3], y = positions[i*3+1], z = positions[i*3+2]
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) { values[i] = NaN; continue }
      const a=bits[i*3], b=bits[i*3+1], c=bits[i*3+2], known=cache.get(a,b,c)
      if (known !== undefined) { values[i]=known; continue }
      const value = scan.closest(x,y,z,hit) ? hit.signed : NaN
      values[i] = value
      // Unavailable correspondence must remain unavailable, never a passing value.
      if (Number.isFinite(value)) cache.set(a,b,c,value)
    }
    return values
  }
}

export type PreviewColouring = 'gradient' | 'pass-fail'
/** Linear RGB colours for Three vertex attributes. Green within tolerance;
 * gradient spans tolerance to five tolerances, with black off-scale caps.
 * Native legend supports these bands; exact native interpolation is unverified. */
export function previewDeviationColours(values: Float32Array, tolerance: number, mode: PreviewColouring): Float32Array {
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new Error('Tolerance must be positive and finite.')
  const out = new Float32Array(values.length * 3)
  for (let i = 0; i < values.length; i++) {
    const d = values[i], ratio = Math.abs(d) / tolerance
    let rgb: number[] = [0.25, 0.25, 0.25]
    if (Number.isFinite(d)) {
      if (ratio <= 1) rgb = [0, 1, 0]
      else if (mode === 'pass-fail') rgb = [1, 0, 0]
      else if (ratio > 5) rgb = [0, 0, 0]
      else {
        const t = (ratio - 1) / 4
        rgb = d > 0 ? [Math.min(1, 2*t), Math.min(1, 2*(1-t)), 0] : [0, Math.min(1, 2*(1-t)), Math.min(1, 2*t)]
      }
    }
    out.set(rgb, i * 3)
  }
  return out
}
