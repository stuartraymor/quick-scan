// SPDX-License-Identifier: AGPL-3.0-only
import type { LinkedView } from './cameraLink'

/** Optional presentation data, carried by the extensible project manifest. */
export interface ProjectView {
  position: number[]
  target: number[]
  up: number[]
  zoom: number
  halfW: number
  halfH: number
}

export function captureProjectView(view: LinkedView): ProjectView {
  return { position: view.camera.position.toArray(), target: view.target.toArray(),
    up: view.camera.up.toArray(), zoom: view.camera.zoom, ...view.extents() }
}

/** Presentation corruption must not prevent recovery of the actual part. */
export function readProjectView(raw: unknown): ProjectView | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as ProjectView
  const vector = (a: unknown): a is number[] => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite)
  if (!vector(v.position) || !vector(v.target) || !vector(v.up) ||
      ![v.zoom, v.halfW, v.halfH].every(n => Number.isFinite(n) && n > 0)) return null
  const d = v.position.map((n, i) => n - v.target[i])
  const cross = [d[1]*v.up[2]-d[2]*v.up[1], d[2]*v.up[0]-d[0]*v.up[2], d[0]*v.up[1]-d[1]*v.up[0]]
  if (Math.hypot(...cross) < 1e-12) return null
  return v
}
