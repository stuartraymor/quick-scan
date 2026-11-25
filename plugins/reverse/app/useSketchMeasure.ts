// SPDX-License-Identifier: AGPL-3.0-only
// Analysis → Measure's Sketch way: a click on a sketch reads it, read only.
// On the part, every shown sketch is stood in its plane: the click's ray
// meets each sketch's plane and is taken there as the Dimension tool takes
// a click on the sheet (core/measurePick). With a sketch open, the sheet
// over the view is what is clicked. The readouts go to the Measure dialog's
// list (src/state/measureToolStore) and are drawn over the view.

import { useRef, type RefObject } from 'react'
import type { Vec2 } from '../../../src/core/flat/types'
import { pointOnSheet, type SectionFrame } from '../../../src/core/section/frame'
import type { Vec3 } from '../../../src/core/types'
import { dot, sub } from '../../../src/core/vec'
import type { PluginRuntime } from '../../../src/plugins/api'
import { useMeasureTool, type MeasureReadout, type MeasureRow } from '../../../src/state/measureToolStore'
import { useExplorer } from '../../../src/state/explorerStore'
import { useShell } from '../../../src/state/shellStore'
import { snapFlags } from '../../../src/state/snapFilterStore'
import type { FlatScene } from '../../../src/viewer/FlatScene'
import type { SceneManager } from '../../../src/viewer/SceneManager'
import { bodyMaker, type SketchFeature } from '../core/features'
import type { MeasureResult } from '../core/measureEval'
import { measureAnalytic, type AnalyticGeometry } from '../../../src/core/measure/analytic'
import { bodyReading, type BodyReading } from '../core/measureBody'
import { sketchMeasureRows } from '../core/measurePresentation'
import { dimAnchorAt } from '../core/draw'
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

function onSheet(allow: ReturnType<typeof snapFlags>, sheet: FlatScene, sketch: Sketch, frame:SectionFrame, name: string, x: number, y: number): Taken | null {
  const spot = sheet.sheetPoint(x, y)
  if (!spot) return null
  const radius = reachOn((cx, cy) => sheet.sheetPoint(cx, cy), x, y, spot)
  if (!(radius > 0)) return null
  const hit = measureHitAt(sketch, spot, radius, allow)
  if (!hit) return null
  return { key: 'draft', name, sketch, hit, place: p => liftPoint(frame, p), screen: p => sheet.sheetScreenPoint(pointOnSheet(frame, p).at) }
}

// An actual marker outranks a stroke, then a sheet origin, then a filled region.
function hitRank(hit: MeasureHit): number {
  if (hit.kind === 'pick') return hit.pick.kind === 'point' || hit.pick.via ? 0 : 1
  return hit.kind === 'origin' ? 2 : 3
}

/** On an oblique sheet a circle of screen pixels maps to an ellipse on
 * the sheet. At edge-on it has no inverse at all. Use the forward map. */
function projectedAnchor(scene: SceneManager, f: SketchFeature, x: number, y: number, allow: ReturnType<typeof snapFlags>) {
  const project = (p: Vec2) => scene.screenPointOf(liftPoint(f.frame, p))
  // Orthographic projection is affine. Read the viewport once per basis
  // point instead of once per anchor when hovering over a large sketch.
  const o = project([0, 0]), u = project([1, 0]), v = project([0, 1])
  return dimAnchorAt(f.sketch, REACH_PX, allow, p => {
    if (o && u && v) {
      const dx = o.x - x + p[0] * (u.x - o.x) + p[1] * (v.x - o.x)
      const dy = o.y - y + p[0] * (u.y - o.y) + p[1] * (v.y - o.y)
      if (Math.hypot(dx, dy) > REACH_PX) return Infinity
    }
    const q = project(p)
    return q ? Math.hypot(q.x - x, q.y - y) : Infinity
  }, (a, b) => {
    const pa = project(a), pb = project(b)
    return Boolean(pa && pb && Math.hypot(pa.x - pb.x, pa.y - pb.y) < 1)
  })
}

function onPart(allow: ReturnType<typeof snapFlags>, scene: SceneManager, sketches: readonly SketchFeature[], x: number, y: number, focus: string | null): Taken | null {
  const re = reSceneOf(scene)
  const ray = re.partRayAt(x, y)
  const side = re.partRayAt(x + 1, y)
  if (!ray || !side) return null
  let best: { taken: Taken; t: number; rank: number } | null = null
  for (const f of sketches) {
    const at = planeSpot(f.frame, ray.origin, ray.dir)
    const near = planeSpot(f.frame, side.origin, side.dir)
    let hit: MeasureHit | null
    let depth: number
    const oblique = Math.abs(dot(f.frame.normal, ray.dir)) < 1 - 1e-9
    const pick = oblique ? projectedAnchor(scene, f, x, y, allow) : null
    if (pick) {
      hit = { kind: 'pick', pick }
      const point = pointOfHit(f.sketch, hit)
      if (!point) continue
      depth = dot(sub(liftPoint(f.frame, point), ray.origin), ray.dir)
    } else if (at && near) {
      const radius = REACH_PX * Math.hypot(near.spot[0] - at.spot[0], near.spot[1] - at.spot[1])
      if (!(radius > 0)) continue
      hit = measureHitAt(f.sketch, at.spot, radius, allow)
      if (oblique && hit && hitRank(hit) === 0) continue
      depth = at.t
    } else {
      continue
    }
    if (!hit) continue
    // The highlighted sketch resolves overlapping targets of equal kind.
    const rank = 2 * hitRank(hit) - Number(focus === `reverse:feature:${f.id}`)
    if (!best || rank < best.rank || (rank === best.rank && depth < best.t)) {
      const frame: SectionFrame = f.frame
      best = { taken: { key: String(f.id), name: f.name, sketch: f.sketch, hit, place: (p) => liftPoint(frame, p) }, t: depth, rank }
    }
  }
  return best?.taken ?? null
}

const asRows = (rows: MeasureResult[]): MeasureRow[] => rows.map((r) => ({ label: r.label, value: r.value, unit: r.unit, point: r.point, exact: r.exact, note: r.note }))

/** The readout as the Measure list keeps it, its first result with points
 *  to stand between boxed over the view. */
function readoutOf(r: SketchReadout, place: (p: Vec2) => Vec3, screen: Taken['screen'], tag?: string): MeasureReadout {
  const at = r.rows.findIndex((x) => x.witness && x.witness.length > 0 && Number.isFinite(x.value))
  const lead = at >= 0 ? r.rows[at] : r.rows.find((x) => x.point)
  const witness = lead?.witness ?? (lead?.point ? [lead.point] : [])
  const caption = at >= 0 && r.rows[at].unit !== 'point' ? { row: at, sign: shortOf(r.rows[at].key) } : undefined
  return { kind: 'readout', tag, title: r.title, rows: sketchMeasureRows(r.rows,place,Boolean(screen)), witness: witness.map(place), caption, screen }
}

interface Reading extends BodyReading {
  source?: Taken
  valid: () => boolean
}

function sketchReading(taken: Taken, automatic: boolean): Reading {
  const { sketch, place, screen, name } = taken
  let hit = taken.hit
  if (automatic && hit.kind === 'pick' && hit.pick.kind === 'piece' && hit.pick.via) {
    hit = { kind: 'pick', pick: { kind: 'point', anchor: hit.pick.via } }
  }
  const one = readoutOne(sketch, hit, name)
  const own = pointOfHit(sketch, hit)
  const geometry: AnalyticGeometry | undefined = own ? { kind: 'point', at: place(own) } : undefined
  const readout = readoutOf(one, place, screen)
  return {
    source: taken, geometry, readout,
    id: `sketch/${taken.key}/${JSON.stringify(refOfHit(hit, true))}`,
    outline: outlineOfHit(sketch, hit).map(loop => loop.map(place)),
    valid: () => {
      const state = useReverse.getState()
      if (taken.key === 'draft') return state.sketchDraft?.sketch === sketch
      return state.features.some(f => f.kind === 'sketch' && f.visible && String(f.id) === taken.key && f.sketch === sketch)
    },
  }
}

function pairReading(a: Reading, b: Reading): MeasureReadout | null {
  if (a.id === b.id || a.source?.hit.kind === 'region' || b.source?.hit.kind === 'region') return null
  if (a.source && b.source && a.source.key === b.source.key) {
    const t = b.source
    return readoutOf(readoutTwo(t.sketch, a.source.hit, t.hit, t.name), t.place, t.screen)
  }
  const title = `${a.readout.title} → ${b.readout.title}`
  if (a.geometry?.kind === 'point' && b.geometry?.kind === 'point') {
    const pa = a.geometry.at, pb = b.geometry.at
    return { kind: 'readout', title, rows: asRows(readoutAcross(pa, pb, title).rows), witness: [pa, pb], caption: { row: 0, sign: '' } }
  }
  if (a.geometry && b.geometry) {
    const result = measureAnalytic(a.geometry, b.geometry)
    if (result.values.length) {
      const rows = result.values.map(v => ({ label: v.label, value: v.value, unit: v.unit, exact: true, note: v.domain }))
      const index = result.values.findIndex(v => v.witness)
      return { kind: 'readout', title, rows, witness: result.values[index]?.witness ?? [], caption: index >= 0 ? { row: index, sign: '' } : undefined }
    }
  }
  // Preserve the useful single-entity properties and let this pick start a new pair.
  return null
}

export function useSketchMeasure(sceneRef: RefObject<SceneManager | null>, sheetRef: RefObject<FlatScene | null>): NonNullable<PluginRuntime['measure']> {
  const first = useRef<{ taken: Reading; tag: string; mode: string } | null>(null)
  const serial = useRef(0)
  const hasSketch = useReverse(s => Boolean(s.sketchDraft) || s.features.some(f => f.kind === 'sketch' && f.visible))
  const hasBodies = useReverse(s => !s.bodiesHidden && s.bodies.some(b => b.visible))
  const editingSketch = useReverse(s => Boolean(s.sketchDraft))
  const geometrySnaps = editingSketch ? 'sketchPick' : 'pick'
  const cadMode = 'plugin:cad'
  const takeAt = (mode: string, x: number, y: number): Reading | null => {
    if (mode !== SKETCH_MEASURE_MODE && mode !== cadMode) return null
    const automatic = useMeasureTool.getState().mode === 'adaptive'
    const scene = sceneRef.current, sheet = sheetRef.current, state = useReverse.getState()
    const draft = state.sketchDraft
    const allow = snapFlags(geometrySnaps)
    const focus = useExplorer.getState().focus
    const focused = automatic && focus ? state.features.find(f => focus === `reverse:feature:${f.id}`) : undefined
    const solidFeature = focused?.kind === 'sketch' ? undefined : focused
    let sketch: Taken | null = null
    if (automatic || mode === SKETCH_MEASURE_MODE) {
      if (draft && sheet) sketch = onSheet(allow, sheet, draft.sketch, draft.frame, draft.name ?? 'Sketch', x, y)
      if (scene && (!sketch || hitRank(sketch.hit) > 0 || focus)) {
        const shown = state.features.filter((f): f is SketchFeature => f.kind === 'sketch' && f.visible && !f.suppressed && f.id !== draft?.featureId)
        const other = onPart(allow, scene, shown, x, y, focus)
        if (other && (!sketch || hitRank(other.hit) < hitRank(sketch.hit) ||
          (hitRank(other.hit) === hitRank(sketch.hit) && focus === `reverse:feature:${other.key}`))) sketch = other
      }
      if (sketch && ((hitRank(sketch.hit) === 0 && !solidFeature) || (!automatic && sketch.hit.kind !== 'region'))) return sketchReading(sketch, automatic)
    }
    if (scene && hasBodies && (automatic || mode === cadMode)) {
      const target = reSceneOf(scene).bodyPicks.measureAt(x, y, allow)
      // A visible CAD anchor can coincide with a sketch stroke or its origin.
      // Keep the sketch target if the body only offers a face or an edge there.
      if (target && (target.kind === 'point' || !sketch || sketch.hit.kind === 'region')) {
        const bodyId = target.kind === 'point' ? target.bodyId : target.hit.bodyId
        if (sketch && hitRank(sketch.hit) === 0 && solidFeature && bodyMaker(bodyId) !== solidFeature.id &&
          !state.results[solidFeature.id]?.bodies?.includes(bodyId)) return sketchReading(sketch, automatic)
        return { ...bodyReading(target), valid: () => {
          const now = useReverse.getState()
          return now.bodiesVersion === state.bodiesVersion && !now.bodiesHidden && now.bodies.some(b => b.id === bodyId && b.visible)
        } }
      }
    }
    return sketch ? sketchReading(sketch, automatic) : null
  }
  const waiting = () => {
    const last = first.current, tool = useMeasureTool.getState()
    return last && last.mode === tool.mode && last.taken.valid() && tool.items.some(m => m.kind === 'readout' && m.tag === last.tag) ? last.taken : null
  }
  const inspect = (taken: Reading, commit: boolean) => {
    const last = waiting()
    const pair = last && pairReading(last, taken)
    const readout = pair || taken.readout
    if (commit) {
      const tool = useMeasureTool.getState()
      if (pair) {
        tool.add(pair)
        first.current = null
      } else {
        const tag = `measure-${++serial.current}`
        tool.add({ ...taken.readout, tag })
        first.current = { taken, tag, mode: tool.mode }
      }
    }
    const lead = readout.caption
    const region = !pair && taken.source?.hit.kind === 'region'
    return { outline: taken.outline, witness: region ? [] : readout.witness,
      pointLabel: taken.geometry?.kind === 'point' && !pair && !lead ? taken.readout.title : undefined,
      row: lead && !region ? readout.rows[lead.row] : undefined, sign: lead?.sign, screen: readout.screen }
  }
  return {
    modes: [
      { id: SKETCH_MEASURE_MODE, label: 'Sketch', title: 'Measure sketch points, pieces and closed profiles', snap: geometrySnaps, disabled: !hasSketch, choose: () => useShell.getState().setWorkspace('reverse'), adaptive: !hasBodies },
      { id: cadMode, label: 'CAD', title: 'Measure visible body vertices, midpoints, circle centers, edges and faces', snap: geometrySnaps, disabled: !hasBodies, adaptive: hasBodies },
    ],
    hover: (mode, x, y) => {
      const taken = takeAt(mode, x, y)
      return taken && inspect(taken, false)
    },
    pick: (mode, x, y) => {
      const taken = takeAt(mode, x, y)
      if (!taken) return false
      inspect(taken, true)
      return true
    },
    meshPoint: (point, commit) => {
      const mesh = sceneRef.current?.scanGeometry()
      return inspect({
        id: `mesh/${point.join(',')}`, outline: [], geometry: { kind: 'point', at: point },
        readout: { kind: 'readout', title: 'Scan surface point', witness: [point], rows: [
          { label: 'Position (world XYZ)', point, value: 0, unit: 'point', exact: false, note: 'On the scan mesh' },
        ] },
        valid: () => Boolean(mesh && sceneRef.current?.scanGeometry() === mesh),
      }, commit)
    },
  }
}
