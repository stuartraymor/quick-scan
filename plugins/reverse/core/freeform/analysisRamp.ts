// SPDX-License-Identifier: AGPL-3.0-only
/** Signed scan deviation relative to the fitted surface, normalized by tolerance. */
export const freeformAnalysisRamp = `
vec3 analysisRamp(float deviation, bool passFail) {
  float ratio = abs(deviation);
  if (ratio <= 1.0) return vec3(0.0, 1.0, 0.0);
  if (passFail) return vec3(0.51, 0.0, 0.0);
  if (ratio > 5.0) return vec3(0.25);
  float fade = 1.0 - (ratio - 1.0) / 4.0;
  return deviation > 0.0 ? vec3(1.0, fade, 0.0) : vec3(0.0, fade, 1.0);
}`

export function measuredDeviationStats(values: Float32Array, tolerance: number) {
  let count = 0, within = 0, min = Infinity, max = -Infinity, sum = 0, squared = 0
  for (const value of values) {
    if (!Number.isFinite(value)) continue
    min = Math.min(min, value)
    max = Math.max(max, value)
    sum += value
    squared += value * value
    count++
    if (Math.abs(value) <= tolerance) within++
  }
  return count ? { count, missing: values.length - count, min, max, mean: sum / count, rms: Math.sqrt(squared / count), within } : null
}
