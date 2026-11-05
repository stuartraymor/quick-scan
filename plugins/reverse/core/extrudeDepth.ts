// SPDX-License-Identifier: AGPL-3.0-only
import type { ExtrudeExtent } from './features'

export type DistanceExtent = Extract<ExtrudeExtent, { kind: 'distance' }>

export function spansSketch({ from, to }: DistanceExtent): boolean {
  return Math.min(from, to) <= 0 && Math.max(from, to) >= 0
}

/** Resize the two physical sides about the sketch, keeping their proportions
 *  and orientation. An empty interval at the sketch grows along its normal. */
export function resizeFullDepth(extent: DistanceExtent, total: number): DistanceExtent {
  if (!spansSketch(extent) || !Number.isFinite(total) || total <= 0) return extent
  const span = Math.abs(extent.to - extent.from)
  if (span === 0) return { kind: 'distance', from: 0, to: total }
  return { kind: 'distance', from: (extent.from / span) * total, to: (extent.to / span) * total }
}

/** A reversed coordinate and its displayed depth use the same expression with
 *  opposite signs. Only unwrap a complete negation, not `-(a) + (b)`. */
export function negateExpression(expression: string): string {
  const text = expression.trim()
  if (text.startsWith('-(')) {
    let depth = 0
    for (let i = 1; i < text.length; i++) {
      if (text[i] === '(') depth++
      if (text[i] === ')' && --depth === 0) {
        if (i === text.length - 1) return text.slice(2, -1)
        break
      }
    }
  }
  return `-(${text})`
}
