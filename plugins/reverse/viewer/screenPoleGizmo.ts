// SPDX-License-Identifier: AGPL-3.0-only
export type ScreenPoleHandle = 'x' | 'y' | 'plane'

/** Native Screen horizontal-arrow experiments: horizontal and vertical
 * input separately, and single/stepped diagonal inputs. Other frames are
 * not covered by this rule. */
export function screenArrowStep(dx: number, dy: number, axis: 'x' | 'y'): number {
  return projectedArrowStep(dx, dy, axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0)
}

/** Axis projection in screen pixels per model unit. Native World-X and
 * Screen-axis measurements support this same inverse projection. */
export function projectedArrowStep(dx: number, dy: number, projectedX: number, projectedY: number): number {
  const along = dx * projectedX + dy * projectedY
  return Math.abs(along) < 1e-12 ? 0 : (dx * dx + dy * dy) / along
}

export function screenPoleHandle(x: number, y: number): ScreenPoleHandle | null {
  if (x >= 54 && x <= 122 && Math.abs(y) <= 12) return 'x'
  if (y <= -54 && y >= -122 && Math.abs(x) <= 12) return 'y'
  if (x >= 24 && x <= 65 && y >= -65 && y <= -24) return 'plane'
  return null
}

/** Screen-space adornment only. Pointer events continue to the canvas and
 * its scene-layer handler so navigation and capture follow one route. */
export class ScreenPoleGizmo {
  private element: HTMLDivElement | null = null
  constructor(private container: HTMLElement | undefined) {}
  show(x: number, y: number) {
    if (!this.container) return
    if (!this.element) {
      const e = document.createElement('div')
      e.dataset.test = 'surface-screen-gizmo'
      Object.assign(e.style, { position: 'absolute', width: '250px', height: '250px', pointerEvents: 'none', zIndex: '4' })
      e.innerHTML = '<svg width="250" height="250" viewBox="-125 -125 250 250" aria-hidden="true"><path d="M60 0 H106" stroke="#ed3030" stroke-width="7"/><path d="M103 -11 L122 0 L103 11 Z" fill="#ed3030"/><path d="M0 -60 V-106" stroke="#00bf35" stroke-width="7"/><path d="M-11 -103 L0 -122 L11 -103 Z" fill="#00bf35"/><rect x="24" y="-65" width="41" height="41" fill="#d5e9e4" fill-opacity="0.6" stroke="#b8d2c9"/></svg>'
      this.container.appendChild(e); this.element = e
    }
    const r = this.container.getBoundingClientRect()
    this.element.style.left = `${x - r.left - 125}px`
    this.element.style.top = `${y - r.top - 125}px`
  }
  hide() { this.element?.remove(); this.element = null }
}
