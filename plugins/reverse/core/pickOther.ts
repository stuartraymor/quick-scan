// SPDX-License-Identifier: AGPL-3.0-only
// "Select other": everything a click at one spot of the sheet could take, so
// that where pieces or points lie on top of each other — two concentric
// circles' one centre, a line drawn over another, an end on a rim — the hand
// can choose which, rather than take the nearest. The brief's selection
// cycling (Part 2.4, test C16). No store: the menu calls this with what is
// under the cursor and hands the choice back to the click as `prefer`.

import type { Vec2 } from '../../../src/core/flat/types'
import { len2, sub2 } from '../../../src/core/flat/vec2'
import { entityOf, nearestOnEntity, type Sketch, type SketchEntity } from './sketch'
import { datumName, traceNear, type DatumTrace } from './datums'
import { dimPickAt, originPick, relPickAt, visitPickAnchors, type DimPick, type PickAllow } from './draw'

/** What the tool in hand picks with: the arrow and most relations take whole
 *  pieces; Concentric takes a round piece by its rim or its centre;
 *  Coincident and the Dimension tool take points as well. */
export type PickMode = 'select' | 'relation' | 'concentric' | 'coincident' | 'dimension'

export interface PickChoice {
  pick: DimPick
  label: string
  /** The piece the choice belongs to, null for a plane or the origin. */
  piece: number | null
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
/** A piece's name as the relation rows write it: "circle 3". */
export const pieceName = (e: SketchEntity) => `${e.kind} ${e.id}`

/** The words for a pick: "Circle 3", "Centre of circle 3", "End of line 2". */
export function pickLabel(sketch: Sketch, pick: DimPick): string {
  if (pick.kind === 'datum') return datumName(pick.plane)
  if (pick.kind === 'origin') return 'Origin'
  const id = pick.kind === 'piece' ? pick.id : pick.anchor.entity
  const e = entityOf(sketch, id)
  if (!e) return `#${id}`
  if (pick.kind === 'piece') return capital(pieceName(e))
  if (e.kind === 'point') return capital(pieceName(e))
  const at = pick.anchor.at
  const what = at === 'center' ? (e.kind === 'line' ? 'Middle' : 'Centre') : at === 'a' ? 'Start' : at === 'b' ? 'End' : /^q\d$/.test(at) ? 'Quadrant point' : 'Point'
  return `${what} of ${pieceName(e)}`
}

/** Two picks of the same thing: the same piece, point, plane or origin. A
 *  piece taken on a square (`via`) is still the piece. */
export function samePick(a: DimPick, b: DimPick): boolean {
  if (a.kind === 'piece' && b.kind === 'piece') return a.id === b.id
  if (a.kind === 'point' && b.kind === 'point') return a.anchor.entity === b.anchor.entity && a.anchor.at === b.anchor.at
  if (a.kind === 'datum' && b.kind === 'datum') return a.plane === b.plane
  return a.kind === 'origin' && b.kind === 'origin'
}

/** The pick a plain click at the spot takes with the tool in hand — the
 *  store's own rule, kept here so the list can put it first. */
export function defaultPick(sketch: Sketch, spot: Vec2, radius: number, datums: readonly DatumTrace[], mode: PickMode, allow: PickAllow): DimPick | null {
  if (mode === 'coincident') return relPickAt(sketch, spot, radius, datums, allow)
  if (mode === 'dimension') return dimPickAt(sketch, spot, radius, datums, allow, true)
  const piece = nearestPiece(sketch, spot, radius)
  if (piece) return { kind: 'piece', id: piece.id }
  const round = mode === 'concentric' || mode === 'select' ? roundAtCentre(sketch, spot, radius) : null
  return round ? { kind: 'piece', id: round.id } : null
}

function nearestPiece(sketch: Sketch, spot: Vec2, radius: number): SketchEntity | null {
  let best: SketchEntity | null = null
  let bestD = radius
  for (const e of sketch.entities) {
    const { dist } = nearestOnEntity(e, spot)
    if (dist <= bestD) {
      bestD = dist
      best = e
    }
  }
  return best
}

function roundAtCentre(sketch: Sketch, spot: Vec2, radius: number): SketchEntity | null {
  let best: SketchEntity | null = null
  let bestD = radius * 0.75
  for (const e of sketch.entities) {
    if (e.kind !== 'arc' && e.kind !== 'circle') continue
    const d = len2(sub2(e.c, spot))
    if (d <= bestD) {
      bestD = d
      best = e
    }
  }
  return best
}

/**
 * Everything a click at `spot` could take with the tool in hand, the one a
 * plain click takes first and the rest nearest first. Two or more is what
 * "Select other" offers. Geometry pickers offer anchors and pieces within the click radius; in the arrow's mode a
 * round piece is also taken by its centre, where there is no rim to click.
 */
export function picksAt(sketch: Sketch, spot: Vec2, radius: number, datums: readonly DatumTrace[], mode: PickMode, allow: PickAllow): PickChoice[] {
  const found: { pick: DimPick; d: number }[] = []
  const add = (pick: DimPick, d: number) => {
    const had = found.find((f) => samePick(f.pick, pick))
    if (had) had.d = Math.min(had.d, d)
    else found.push({ pick, d })
  }
  const points = mode === 'coincident' || mode === 'dimension'
  const pointReach = radius * 0.75
  if (points) visitPickAnchors(sketch, allow, (entity, at, p) => {
    const distance = len2(sub2(p, spot))
    if (distance <= radius) add({ kind: 'point', anchor: { entity, at } }, distance)
  })
  for (const e of sketch.entities) {
    const wholePiece = !points || allow.curve
    if (wholePiece && e.kind !== 'point') {
      const { dist } = nearestOnEntity(e, spot)
      if (dist <= radius) add({ kind: 'piece', id: e.id }, dist)
    }
    if ((mode === 'select' || mode === 'concentric') && (e.kind === 'circle' || e.kind === 'arc')) {
      const d = len2(sub2(e.c, spot))
      if (d <= pointReach) add({ kind: 'piece', id: e.id }, d)
    }
  }
  if (points) {
    const trace = traceNear(datums, spot, radius)
    if (trace) add({ kind: 'datum', plane: trace.plane }, Math.abs(trace.n[0] * spot[0] + trace.n[1] * spot[1] + trace.d))
    if (mode === 'coincident' && len2(spot) <= pointReach) {
      const origin = originPick(datums)
      if (origin) add(origin, len2(spot))
    }
  }
  found.sort((a, b) => a.d - b.d)
  const first = defaultPick(sketch, spot, radius, datums, mode, allow)
  const picks = found.map((f) => f.pick)
  const ordered = first ? [first, ...picks.filter((p) => !samePick(p, first))] : picks
  return ordered.map((pick) => ({
    pick,
    label: pickLabel(sketch, pick),
    piece: pick.kind === 'piece' ? pick.id : pick.kind === 'point' ? pick.anchor.entity : null,
  }))
}
