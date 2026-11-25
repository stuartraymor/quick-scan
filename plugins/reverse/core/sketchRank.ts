// SPDX-License-Identifier: AGPL-3.0-only
import { symmetricEigenN } from '../../../src/core/fit/linalg'

/** Count eigenvalues below the sketch solver's dependency tolerance.
 * Subtracting the threshold from the diagonal turns the count into the
 * negative inertia of a symmetric matrix. Symmetric elimination preserves
 * inertia, so each negative pivot accounts for exactly one dependency.
 * Fall back to the original Jacobi method for ambiguous or unstable pivots. */
export function countBelowThreshold(gram: Float64Array, size: number, threshold: number): number {
  const spectralCount = () => symmetricEigenN(size, gram).values.filter(value => value < threshold).length
  if (size < 16) return spectralCount()
  const matrix = gram.slice()
  let scale = 1
  for (let i = 0; i < size; i++) {
    matrix[i * size + i] -= threshold
    scale = Math.max(scale, Math.abs(matrix[i * size + i]))
  }
  const pivotFloor = 64 * Number.EPSILON * size * scale
  let negative = 0
  for (let k = 0; k < size; k++) {
    let best = k
    for (let i = k + 1; i < size; i++) {
      if (Math.abs(matrix[i * size + i]) > Math.abs(matrix[best * size + best])) best = i
    }
    const pivot = matrix[best * size + best]
    if (Math.abs(pivot) <= pivotFloor) return spectralCount()
    if (pivot < 0) negative++
    // Only the trailing square is active. Swap both rows and columns.
    if (best !== k) {
      for (let i = k; i < size; i++) {
        const saved = matrix[k * size + i]
        matrix[k * size + i] = matrix[best * size + i]
        matrix[best * size + i] = saved
      }
      for (let i = k; i < size; i++) {
        const saved = matrix[i * size + k]
        matrix[i * size + k] = matrix[i * size + best]
        matrix[i * size + best] = saved
      }
    }
    for (let i = k + 1; i < size; i++) {
      const multiplier = matrix[i * size + k] / pivot
      if (multiplier === 0) continue
      // A large multiplier needs an indefinite two-by-two pivot. The
      // established spectral method already handles that case reliably.
      if (Math.abs(multiplier) > 2) return spectralCount()
      for (let j = k + 1; j <= i; j++) {
        const value = matrix[i * size + j] - multiplier * matrix[k * size + j]
        matrix[i * size + j] = value
        matrix[j * size + i] = value
      }
    }
  }
  return negative
}
