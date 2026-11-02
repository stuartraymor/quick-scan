// SPDX-License-Identifier: AGPL-3.0-only
export interface QuickBounds { left: number; top: number; right: number; bottom: number }
/** Reference: 186 x 70, centred 132 px above the pick; keep controls usable at edges. */
export function extractQuickPlacement(point: { x: number; y: number }, viewport: QuickBounds, panel?: QuickBounds) {
  const gap = 8, height = 70, width = Math.min(186, Math.max(0, viewport.right - viewport.left - gap * 2))
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)))
  const leftMin = viewport.left + gap, leftMax = viewport.right - width - gap
  const topMin = viewport.top + gap, topMax = viewport.bottom - height - gap
  let left = clamp(point.x - width / 2, leftMin, leftMax)
  let top = clamp(point.y - 132 < topMin ? point.y + 62 : point.y - 132, topMin, topMax)
  const overlaps = () => panel && left < panel.right + gap && left + width > panel.left - gap && top < panel.bottom + gap && top + height > panel.top - gap
  if (overlaps() && panel) {
    const candidates = [
      { left: panel.right + gap, top }, { left: panel.left - width - gap, top },
      { left, top: panel.bottom + gap }, { left, top: panel.top - height - gap },
    ].filter(p => p.left >= leftMin && p.left <= leftMax && p.top >= topMin && p.top <= topMax)
    candidates.sort((a, b) => Math.hypot(a.left - left, a.top - top) - Math.hypot(b.left - left, b.top - top))
    if (candidates[0]) ({ left, top } = candidates[0])
  }
  return { left, top, width }
}
