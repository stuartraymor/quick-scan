// SPDX-License-Identifier: AGPL-3.0-only
// Analysis → Measure's Sketch way: a click on a sketch reads it, read only.
// On the part, every shown sketch is stood in its plane: the click's ray
// meets each sketch's plane and is taken there as the Dimension tool takes
// a click on the sheet (core/measurePick). With a sketch open, the sheet
// over the view is what is clicked. The readouts go to the Measure dialog's
// list (src/state/measureToolStore) and are drawn over the view.

import { useRef, type RefObject } from 'react'
import type { Vec2 } from '../../../src/core/flat/types'
import type { SectionFrame } from '../../../src/core/section/frame'
import type { Vec3 } from '../../../src/core/types'
import type { PluginRuntime } from '../../../src/plugins/api'
import { useMeasureTool, type MeasurePreview, type MeasureReadout, type MeasureRow } from '../../../src/state/measureToolStore'
import { useShell } from '../../../src/state/shellStore'
import { snapFlags } from '../../../src/state/snapFilterStore'
import type { FlatScene } from '../../../src/viewer/FlatScene'
import type { SceneManager } from '../../../src/viewer/SceneManager'
import type { SketchFeature } from '../core/features'
import type { MeasureResult } from '../core/measureEval'
import { measureHitAt, outlineOfHit, planeSpot, pointOfHit, readoutAcross, readoutOne, readoutTwo, refOfHit, shortOf, type MeasureHit, type SketchReadout } from '../core/measurePick'
import { liftPoint } from '../core/profiles'
import type { Sketch } from '../core/sketch'
import { useReverse } from '../state/reStore'
import { reSceneOf } from '../viewer/reScene'

export const SKETCH_MEASURE_MODE = 'plugin:sketch' as const

/** How near the cursor a piece or a point must be, in screen pixels: the
 *  Dimension tool's reach. */
const REACH_PX = 8

/** A click's hit on one sketch, with what it takes to place its results. */
interface Taken {
  /** Which sketch: its feature's id, or 'draft' for the one open. */
  key: string
  name: string
  sketch: Sketch
  hit: MeasureHit
  /** A sheet point where the readout is drawn: lifted into the part, or
   *  left on the open sheet (z 0) with `screen` to place it. */
  place: (p: Vec2) => Vec3
  screen?: (p: Vec3) => { x: number; y: number } | null
}

/** The sheet's millimetres under `REACH_PX` of screen at a client point. */
function reachOn(at: (x: number, y: number) => Vec2 | null, x: number, y: number, spot: Vec2): number {
  const side = at(x + 1, y)
  const px = side ? Math.hypot(side[0] - spot[0], side[1] - spot[1]) : 0
  return px > 0 ? REACH_PX * px : 0
}

function onSheet(sheet: FlatScene, sketch: Sketch, name: string, x: number, y: number): Taken | null {
  const spot = sheet.sheetPoint(x, y)
  if (!spot) return null
  const radius = reachOn((cx, cy) => sheet.sheetPoint(cx, cy), x, y, spot)
  if (!(radius > 0)) return null
  const hit = measureHitAt(sketch, spot, radius, snapFlags('pick'))
  if (!hit) return null
  return { key: 'draft', name, sketch, hit, place: (p) => [p[0], p[1], 0], screen: (p) => sheet.sheetScreenPoint([p[0], p[1]]) }
}

function onPart(scene: SceneManager, sketches: readonly SketchFeature[], x: number, y: number): Taken | null {
  const re = reSceneOf(scene)
  const ray = re.partRayAt(x, y)
  const side = re.partRayAt(x + 1, y)
  if (!ray || !side) return null
  let best: { taken: Taken; t: number; rank: number } | null = null
  const allow = snapFlags('pick')
  for (const f of sketches) {
    const at = planeSpot(f.frame, ray.origin, ray.dir)
    const near = planeSpot(f.frame, side.origin, side.dir)
    if (!at || !near) continue
    const radius = REACH_PX * Math.hypot(near.spot[0] - at.spot[0], near.spot[1] - at.spot[1])
    if (!(radius > 0)) continue
    const hit = measureHitAt(f.sketch, at.spot, radius, allow)
    if (!hit) continue
    // A piece or a point beats a loop clicked inside, whatever the depth;
    // between equals, the sketch nearer the eye.
    const rank = hit.kind === 'region' ? 1 : 0
    if (!best || rank < best.rank || (rank === best.rank && at.t < best.t)) {
      const frame: SectionFrame = f.frame
      best = { taken: { key: String(f.id), name: f.name, sketch: f.sketch, hit, place: (p) => liftPoint(frame, p) }, t: at.t, rank }
    }
  }
  return best?.taken ?? null
}

/** Whether a second pick is the first again — the same piece, the same
 *  point of the same sketch — which pairs with nothing: it starts over. */
const sameAgain = (a: Taken, b: Taken): boolean =>
  a.key === b.key && JSON.stringify(refOfHit(a.hit, true)) === JSON.stringify(refOfHit(b.hit, true))

const asRows = (rows: MeasureResult[]): MeasureRow[] => rows.map((r) => ({ label: r.label, value: r.value, unit: r.unit, point: r.point, exact: r.exact, note: r.note }))

/** The readout as the Measure list keeps it, its first result with points
 *  to stand between boxed over the view. */
function readoutOf(r: SketchReadout, place: (p: Vec2) => Vec3, screen: Taken['screen'], tag?: string): MeasureReadout {
  const at = r.rows.findIndex((x) => x.witness && x.witness.length > 0 && Number.isFinite(x.value))
  const lead = at >= 0 ? r.rows[at] : r.rows.find((x) => x.point)
  const witness = lead?.witness ?? (lead?.point ? [lead.point] : [])
  const caption = at >= 0 && r.rows[at].unit !== 'point' ? { row: at, sign: shortOf(r.rows[at].key) } : undefined
  return { kind: 'readout', tag, title: r.title, rows: asRows(r.rows), witness: witness.map(place), caption, screen }
}

/** A readout's lead result as a preview's figure. */
function leadOf(r: SketchReadout): { row?: MeasureRow; sign?: string; witness?: Vec2[] } {
  const at = r.rows.findIndex((x) => x.witness && x.witness.length > 0 && Number.isFinite(x.value) && x.unit !== 'point')
  if (at < 0) return {}
  const [row] = asRows([r.rows[at]])
  return { row, sign: shortOf(r.rows[at].key), witness: r.rows[at].witness }
}

export function useSketchMeasure(sceneRef: RefObject<SceneManager | null>, sheetRef: RefObject<FlatScene | null>): NonNullable<PluginRuntime['measure']> {
  /** The first of two picks, its readout's tag, and where it is. */
  const first = useRef<{ taken: Taken; tag: string } | null>(null)
  const serial = useRef(0)
  /** What a click at a client point takes: on the open sheet, or on the
   *  part's shown sketches. */
  const takeAt = (x: number, y: number): Taken | null => {
    const scene = sceneRef.current
    const s = useReverse.getState()
    const draft = s.sketchDraft
    const sheet = sheetRef.current
    return draft && sheet
      ? onSheet(sheet, draft.sketch, draft.name ?? 'Sketch', x, y)
      : scene && useShell.getState().workspace === 'reverse'
        ? onPart(scene, s.features.filter((f): f is SketchFeature => f.kind === 'sketch' && f.visible), x, y)
        : null
  }
  /** The first pick, while its readout is still listed. */
  const waiting = (): Taken | null => {
    const tool = useMeasureTool.getState()
    return first.current && tool.items.some((m) => m.kind === 'readout' && m.tag === first.current!.tag) ? first.current.taken : null
  }
  const hasSketch = useReverse((s) => Boolean(s.sketchDraft) || s.features.some((f) => f.kind === 'sketch' && f.visible))
  return {
    modes: [{
      id: SKETCH_MEASURE_MODE,
      label: 'Sketch',
      title: hasSketch
        ? "Measure sketch geometry: click a piece (a circle's radius, diameter and circumference; a line's length), a point (end, centre, quadrant, middle) or inside a closed loop; a second click measures the two together. Nothing is changed. Brings the CAD workspace forward, where the sketches are shown."
        : 'Measure sketch geometry: show a sketch first (CAD → 2D Sketch)',
      disabled: !hasSketch,
      // Picks as Smart Dimension picks: the bar shows its Pick switches.
      snap: 'pick',
      // Analysis opens the Compare workspace, where no sketch is drawn: the
      // Sketch way brings the CAD workspace forward, as Zebra Stripes does
      // from the same tab, the ribbon staying on Analysis.
      choose: () => useShell.getState().setWorkspace('reverse'),
    }],
    hover: (mode, x, y): MeasurePreview | null => {
      if (mode !== SKETCH_MEASURE_MODE) return null
      const taken = takeAt(x, y)
      if (!taken) return null
      const outline = outlineOfHit(taken.sketch, taken.hit).map((loop) => loop.map(taken.place))
      const was = waiting()
      const own = pointOfHit(taken.sketch, taken.hit)
      // With a first pick waiting, the pair's reading; else the thing's own.
      if (was && taken.hit.kind !== 'region' && !sameAgain(was, taken)) {
        if (was.key === taken.key) {
          const lead = leadOf(readoutTwo(taken.sketch, was.hit, taken.hit, taken.name))
          if (lead.row) return { outline, witness: (lead.witness ?? []).map(taken.place), row: lead.row, sign: lead.sign, screen: taken.screen }
        } else {
          const pa = pointOfHit(was.sketch, was.hit)
          if (pa && own) {
            const a = was.place(pa), b = taken.place(own)
            const [row] = asRows(readoutAcross(a, b, '').rows)
            return { outline, witness: [a, b], row, sign: '', screen: taken.screen }
          }
        }
      }
      const lead = leadOf(readoutOne(taken.sketch, taken.hit, taken.name))
      const witness = taken.hit.kind === 'region' ? [] : own && !lead.witness ? [taken.place(own)] : (lead.witness ?? []).map(taken.place)
      return { outline, witness, row: taken.hit.kind === 'region' ? undefined : lead.row, sign: lead.sign, screen: taken.screen }
    },
    pick: (mode, x, y) => {
      if (mode !== SKETCH_MEASURE_MODE) return false
      const taken = takeAt(x, y)
      if (!taken) return false
      const tool = useMeasureTool.getState()
      // The first pick is waiting only while its readout is still listed.
      const was = waiting()
      if (!was || taken.hit.kind === 'region' || was.hit.kind === 'region' || sameAgain(was, taken)) {
        const tag = `sketch-${++serial.current}`
        tool.add(readoutOf(readoutOne(taken.sketch, taken.hit, taken.name), taken.place, taken.screen, tag))
        first.current = taken.hit.kind === 'region' ? null : { taken, tag }
        return true
      }
      first.current = null
      if (was.key === taken.key) {
        tool.add(readoutOf(readoutTwo(taken.sketch, was.hit, taken.hit, taken.name), taken.place, taken.screen))
        return true
      }
      // Two sketches: what is between two of their points, in the part.
      const pa = pointOfHit(was.sketch, was.hit)
      const pb = pointOfHit(taken.sketch, taken.hit)
      if (!pa || !pb) {
        tool.add({ kind: 'readout', title: `${was.name} → ${taken.name}`, rows: [{ label: 'Pick points (ends, centres, quadrant points) to measure between two sketches', value: NaN, unit: 'length', exact: false }], witness: [] })
        return true
      }
      const a = was.place(pa)
      const b = taken.place(pb)
      const r = readoutAcross(a, b, `${was.name} → ${taken.name}`)
      tool.add({ kind: 'readout', title: r.title, rows: asRows(r.rows), witness: [a, b], caption: { row: 0, sign: '' } })
      return true
    },
  }
}
