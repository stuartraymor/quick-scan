// SPDX-License-Identifier: AGPL-3.0-only
// The Extrude and Revolve boxes' actions: started on a sketch or a face,
// edited, their profiles picked, their numbers set, and committed.

import { negateExpression, openingDepth } from '../core/extrudeDepth'
import type { StoreApi } from 'zustand'
import { fmtLen } from '../../../src/core/units'
import { usePrefs } from '../../../src/state/prefsStore'
import { useStore } from '../../../src/state/store'
import { dependentsOf, extentEndsOnPart, FULL_TURN_DEG, planeOffset, planeTakesOffset, revolveMaxDeg, withPlaneOffset, type SketchFeature } from '../core/features'
import { extentThroughPoint } from '../core/preview'
import { findRegions } from '../core/regions'
import { extrudeDraftReady, extrudeHeightAt, extrudePickEnd, revolveDraftReady, startingPitch } from './reDrafts'
import { autoRegions, CLOSE_OTHERS, coilOf, hideSketches, nameFor, remember, withExprs, withoutCoil, withoutTarget } from './reFeatureHelpers'
import { faceExtrudeOp } from './reSketchDraft'
import type { ReState } from './reStore'
import type { PreviewInfo } from './reTypes'

type StoreSet = StoreApi<ReState>['setState']
type StoreGet = StoreApi<ReState>['getState']

/** Which side of an extrude's sketch plane the solid bodies stand on: 1 all
 *  along its normal, -1 all against it, 0 on both sides, or nothing to go
 *  by (no sketch, no solid, a box not known). */
function solidSideOf(s: Pick<ReState, 'features' | 'bodies'>, d: { sketchId: number | null }): -1 | 0 | 1 {
  const sketch = s.features.find((f): f is SketchFeature => f.kind === 'sketch' && f.id === d.sketchId)
  const solids = s.bodies.filter((b) => !b.surface && b.visible !== false && b.box)
  if (!sketch || solids.length === 0) return 0
  const { origin, normal } = sketch.frame
  let lo = Infinity
  let hi = -Infinity
  for (const b of solids) {
    const { min, max } = b.box!
    for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) {
      const h = (x - origin[0]) * normal[0] + (y - origin[1]) * normal[1] + (z - origin[2]) * normal[2]
      if (h < lo) lo = h
      if (h > hi) hi = h
    }
  }
  const eps = 1e-6 * Math.max(1, hi - lo)
  return lo >= -eps ? 1 : hi <= eps ? -1 : 0
}

export const solidSlice = (set: StoreSet, get: StoreGet): Pick<ReState, 'extrudeDraft' | 'startExtrude' | 'editExtrude' | 'setExtrude' | 'setExtrudeOp' | 'extrudeToPoint' | 'flipExtrude' | 'setExtrudeSketchOn' | 'cancelExtrude' | 'extrudeFace' | 'commitExtrude' | 'revolveDraft' | 'startRevolve' | 'editRevolve' | 'setRevolve' | 'setRevolveCoil' | 'cancelRevolve' | 'commitRevolve' | 'toggleDraftRegion' | 'pickAllDraftRegions'> => ({

  // ---- extrude and revolve -------------------------------------------------------
  extrudeDraft: null,
  startExtrude: (sketchId = null, regions = null) =>
    set((s) => {
      const sketches = s.features.filter((f): f is SketchFeature => f.kind === 'sketch')
      const sketch = sketchId !== null ? sketches.find((f) => f.id === sketchId) : sketches[sketches.length - 1]
      // QUICKSURFACE opens an extrude at 0.3 of the profile's longest side
      // (core/extrudeDepth.ts, measured 2026-11-07). With no profile to
      // measure, 10.
      const picked = regions ?? autoRegions(sketch?.sketch)
      const to = (sketch ? openingDepth(sketch.sketch, picked) : null) ?? 10
      // A sketch that closes no region extrudes as a surface, as an open
      // profile does in QUICKSURFACE (its Solid box unticked).
      const surface = Boolean(sketch) && picked.length === 0 && sketch!.sketch.entities.some((e) => !e.construction && e.kind !== 'point') && findRegions(sketch!.sketch).length === 0
      // Join, as a CAD extrude does: every body it meets, a body of its own
      // where it meets none — the first one makes the first body.
      return {
        sketchDraft: null,
        revolveDraft: null,
        featureDraft: null,
        bodyPick: null,
        preview: { status: 'idle' },
        selection: null,
        gripField: null,
        extrudeDraft: {
          sketchId: sketch?.id ?? null,
          regions: picked,
          extent: { kind: 'distance', from: 0, to },
          draftDeg: 0,
          op: 'join',
          ...(surface ? { surface: true } : {}),
        },
      }
    }),
  editExtrude: (id) =>
    set((s) => {
      const f = s.features.find((x) => x.id === id)
      if (!f || f.kind !== 'extrude') return {}
      return {
        sketchDraft: null,
        revolveDraft: null,
        featureDraft: null,
        bodyPick: null,
        preview: { status: 'idle' },
        selection: null,
        gripField: null,
        buildVersion: s.buildVersion + 1,
        extrudeDraft: { featureId: f.id, name: f.name, ...(f.exprs ? { exprs: f.exprs } : {}), sketchId: f.face ? null : f.sketchId, regions: [...f.regions], ...(f.face ? { face: f.face } : {}), extent: f.extent, draftDeg: f.draftDeg ?? 0, ...(f.direction ? { direction: f.direction } : {}), op: f.op },
      }
    }),
  setExtrude: (patch) =>
    set((s) => {
      const d = s.extrudeDraft
      if (!d) return {}
      // Another sketch chosen: its pick starts over.
      const regions =
        patch.regions ??
        (patch.sketchId !== undefined && patch.sketchId !== d.sketchId
          ? autoRegions(s.features.find((f): f is SketchFeature => f.kind === 'sketch' && f.id === patch.sketchId)?.sketch)
          : d.regions)
      // A result chosen by hand stops following the direction.
      const fromFace = d.fromFace && patch.op !== undefined ? { ...d.fromFace, opAuto: false } : d.fromFace
      // A sketch chosen takes the place of a pulled face.
      const { face: _face, ...rest } = d
      const base = patch.sketchId !== undefined && patch.sketchId !== null ? rest : d
      void _face
      return { extrudeDraft: faceExtrudeOp({ ...base, ...patch, regions, ...(fromFace ? { fromFace } : {}) }) }
    }),
  setExtrudeOp: (op) => {
    const d = get().extrudeDraft
    if (!d || d.op === op) return
    get().setExtrude({ op })
    if ((op === 'cut') === (d.op === 'cut')) return
    // A cut goes into the solid and anything else away from it. Where the
    // solids all stand on one side of the sketch's plane — a sketch on a
    // body's top face, or on the plane a block was built up from — that
    // side says which way; where they stand on both, the direction turns
    // over as it always has.
    const side = solidSideOf(get(), d)
    const e = d.extent
    if (side !== 0 && e.kind === 'distance' && !d.face) {
      const now = Math.sign(e.to + e.from) || 1
      const want = op === 'cut' ? side : -side
      if (now !== want) get().flipExtrude()
      return
    }
    get().flipExtrude()
  },
  extrudeToPoint: (point) => {
    const s = get()
    const d = s.extrudeDraft
    // The distance is measured from the sketch's plane, or the pulled
    // face's; swept askew, along the sweep.
    const height = d ? extrudeHeightAt(d, s.features, point) : null
    if (!d || height === null) return 'Choose the sketch first — the distance is measured from its plane.'
    const end = extrudePickEnd(d, height)
    const extent = extentThroughPoint(d.extent, end, height)
    if (!extent) {
      if (d.extent.kind === 'betweenPlanes' || (extentEndsOnPart(d.extent) && end === 'to')) return 'This extent ends on the part already — set Extent to Distance to reach a clicked point.'
      return 'That point lies on the other end — the body would have no height.'
    }
    set({ extrudeDraft: faceExtrudeOp({ ...d, extent }) })
    const h = Math.round(height * 100) / 100
    // Said on the status line, in the units shown.
    const units = usePrefs.getState().units
    return extent.kind === 'symmetric' ? `Total ${fmtLen(extent.total, units, 2)} — each half reaches the point clicked.` : `${end === 'to' ? 'To' : 'From'} = ${fmtLen(h, units, 2)}, the height of the point clicked${h < 0 ? ' — behind the sketch plane' : ''}.`
  },
  flipExtrude: () =>
    set((s) => {
      const d = s.extrudeDraft
      // To next, to last and to a body look the other way along the normal.
      if (d && (d.extent.kind === 'toNext' || d.extent.kind === 'toLast' || d.extent.kind === 'toBody')) return { extrudeDraft: { ...d, extent: { ...d.extent, reverse: !d.extent.reverse } } }
      if (!d || d.extent.kind !== 'distance') return {}
      const neg = (v: number) => (v === 0 ? 0 : -v)
      const exprs = d.exprs && { ...d.exprs }
      if (exprs) {
        for (const key of ['extent.from', 'extent.to']) {
          if (exprs[key]) exprs[key] = negateExpression(exprs[key])
        }
      }
      return { extrudeDraft: faceExtrudeOp({ ...d, exprs, extent: { ...d.extent, from: neg(d.extent.from), to: neg(d.extent.to) } }) }
    }),
  setExtrudeSketchOn: (end) => {
    const s = get()
    const d = s.extrudeDraft
    if (!d || d.face || d.sketchId === null) return 'Choose the sketch first.'
    if (d.extent.kind !== 'distance') return 'Set Extent to Two-sided: the sketch is moved to an end given by a depth.'
    if (d.direction) return 'The sketch moves along its own normal: set Direction to From sketch.'
    const sketch = s.features.find((f): f is SketchFeature => f.kind === 'sketch' && f.id === d.sketchId)
    if (!sketch || !planeTakesOffset(sketch.plane)) return 'This sketch’s plane cannot be moved.'
    const others = dependentsOf(sketch.id, s.features).filter((f) => f.id !== d.featureId)
    if (others.length > 0) return `${sketch.name} is also used by ${others.map((f) => f.name).join(', ')}: moving it would move that too.`
    const { from, to } = d.extent
    const shift = end === 'top' ? Math.max(from, to) : Math.min(from, to)
    if (Math.abs(shift) < 1e-12) return null
    const fix = (v: number) => Number((v - shift).toPrecision(12)) || 0
    const extent = { ...d.extent, from: fix(from), to: fix(to) }
    const { offset: _offset, ...sketchExprs } = sketch.exprs ?? {}
    void _offset
    const moved = { ...withPlaneOffset(sketch, Number((planeOffset(sketch.plane) + shift).toPrecision(12))), ...(sketch.exprs ? { exprs: Object.keys(sketchExprs).length > 0 ? sketchExprs : undefined } : {}) }
    const { 'extent.from': _f, 'extent.to': _t, ...draftExprs } = d.exprs ?? {}
    void _f
    void _t
    set({
      ...remember(s),
      // An extrude being edited is written with its new depths at once, so
      // the sketch and the extrude agree whether the box is saved or not.
      features: s.features.map((f) => (f.id === sketch.id ? moved : f.id === d.featureId && f.kind === 'extrude' ? withExprs({ ...f, extent }, f.exprs ? Object.fromEntries(Object.entries(f.exprs).filter(([k]) => k !== 'extent.from' && k !== 'extent.to')) : undefined) : f)),
      extrudeDraft: { ...d, extent, ...(d.exprs ? { exprs: Object.keys(draftExprs).length > 0 ? draftExprs : undefined } : {}) },
      buildVersion: s.buildVersion + 1,
    })
    return null
  },
  cancelExtrude: () =>
    set((s) => {
      const closed = { extrudeDraft: null, preview: { status: 'idle' } as PreviewInfo, gripField: null, gripHeld: false, ...(s.extrudeDraft?.featureId !== undefined ? { buildVersion: s.buildVersion + 1 } : {}) }
      // The sketch made for a pulled face goes with the pull that was not
      // made — nothing else can have built on it while the box was open.
      const made = s.extrudeDraft?.featureId === undefined ? s.extrudeDraft?.fromFace?.sketchId : undefined
      if (made === undefined || dependentsOf(made, s.features).length > 0) return closed
      const before = s.past[s.past.length - 1]
      return { ...closed, features: s.features.filter((f) => f.id !== made), ...(before ? { past: s.past.slice(0, -1), nextFeatureId: before.nextFeatureId, nextOfKind: before.nextOfKind } : {}), buildVersion: s.buildVersion + 1 }
    }),
  extrudeFace: (bodyId, face) => {
    if (face.fingerprint.kind !== 'plane') return 'Only a flat face can be pulled.'
    set({
      ...CLOSE_OTHERS,
      extrudeDraft: { sketchId: null, regions: [], face: { body: bodyId, face: face.fingerprint }, extent: { kind: 'distance', from: 0, to: 5 }, draftDeg: 0, op: 'join', fromFace: { opAuto: true } },
    })
    return null
  },
  commitExtrude: () => {
    const s = get()
    const d = s.extrudeDraft
    if (!d || !extrudeDraftReady(d)) return null
    if (d.featureId !== undefined) {
      const id = d.featureId
      set({
        ...remember(s),
        features: s.features.map((f) => {
          if (f.id !== id || f.kind !== 'extrude') return f
          const { face: _face, direction: _direction, ...kept } = withoutTarget(f)
          void _face
          void _direction
          return withExprs({ ...kept, name: d.name?.trim() || f.name, sketchId: d.face ? 0 : d.sketchId!, regions: d.face ? [] : [...d.regions], ...(d.face ? { face: d.face } : {}), extent: d.extent, draftDeg: d.draftDeg, ...(d.direction ? { direction: d.direction } : {}), op: d.op }, d.exprs)
        }),
        extrudeDraft: null,
        preview: { status: 'idle' },
        gripField: null,
        buildVersion: s.buildVersion + 1,
      })
      return id
    }
    const id = s.nextFeatureId
    if (d.surface && d.sketchId !== null) {
      // The Solid box unticked: the sketch's pieces swept as a surface.
      const e = d.extent
      const [from, to] = e.kind === 'symmetric' ? [-e.total / 2, e.total / 2] : e.kind === 'distance' ? [e.from, e.to] : [0, 0]
      const sheet = nameFor(s, 'sheet')
      set({
        ...remember(s),
        features: [...hideSketches(s.features, [d.sketchId]), { id, kind: 'sheet', name: d.name?.trim() || sheet.name, sketchId: d.sketchId, from, to, visible: true }],
        nextFeatureId: id + 1,
        nextOfKind: sheet.nextOfKind,
        extrudeDraft: null,
        preview: { status: 'idle' },
        gripField: null,
        buildVersion: s.buildVersion + 1,
      })
      return id
    }
    const { name, nextOfKind } = nameFor(s, 'extrude')
    set({
      ...remember(s),
      features: [
        ...hideSketches(s.features, d.face ? [] : [d.sketchId!]),
        { id, kind: 'extrude', name: d.name?.trim() || name, sketchId: d.face ? 0 : d.sketchId!, regions: d.face ? [] : [...d.regions], ...(d.face ? { face: d.face } : {}), extent: d.extent, draftDeg: d.draftDeg, ...(d.direction ? { direction: d.direction } : {}), op: d.op, ...(d.exprs ? { exprs: d.exprs } : {}), visible: true },
      ],
      nextFeatureId: id + 1,
      nextOfKind,
      extrudeDraft: null,
      preview: { status: 'idle' },
      gripField: null,
      buildVersion: s.buildVersion + 1,
    })
    return id
  },

  revolveDraft: null,
  startRevolve: (sketchId = null, regions = null, axis = null) =>
    set((s) => {
      const sketches = s.features.filter((f): f is SketchFeature => f.kind === 'sketch')
      const sketch = sketchId !== null ? sketches.find((f) => f.id === sketchId) : sketches[sketches.length - 1]
      return {
        sketchDraft: null,
        extrudeDraft: null,
        featureDraft: null,
        bodyPick: null,
        preview: { status: 'idle' },
        selection: null,
        gripField: null,
        revolveDraft: {
          sketchId: sketch?.id ?? null,
          regions: regions ?? autoRegions(sketch?.sketch),
          axis,
          angleDeg: FULL_TURN_DEG,
          pitch: 0,
          leftHanded: false,
          op: 'join',
        },
      }
    }),
  editRevolve: (id) =>
    set((s) => {
      const f = s.features.find((x) => x.id === id)
      if (!f || f.kind !== 'revolve') return {}
      return {
        sketchDraft: null,
        extrudeDraft: null,
        featureDraft: null,
        bodyPick: null,
        preview: { status: 'idle' },
        selection: null,
        gripField: null,
        buildVersion: s.buildVersion + 1,
        revolveDraft: { featureId: f.id, name: f.name, ...(f.exprs ? { exprs: f.exprs } : {}), sketchId: f.sketchId, regions: [...f.regions], axis: f.axis, angleDeg: f.angleDeg, pitch: f.pitch ?? 0, leftHanded: f.leftHanded ?? false, op: f.op },
      }
    }),
  setRevolve: (patch) =>
    set((s) => {
      const d = s.revolveDraft
      if (!d) return {}
      const regions =
        patch.regions ??
        (patch.sketchId !== undefined && patch.sketchId !== d.sketchId
          ? autoRegions(s.features.find((f): f is SketchFeature => f.kind === 'sketch' && f.id === patch.sketchId)?.sketch)
          : d.regions)
      const next = { ...d, ...patch, regions }
      // Without a pitch a revolve stops at a full turn.
      return { revolveDraft: { ...next, angleDeg: Math.min(next.angleDeg, revolveMaxDeg(next.pitch)) } }
    }),
  setRevolveCoil: (on) =>
    set((s) => {
      const d = s.revolveDraft
      if (!d || on === (d.pitch !== 0)) return {}
      if (!on) return { revolveDraft: { ...d, pitch: 0, angleDeg: Math.min(d.angleDeg, FULL_TURN_DEG) } }
      const store = useStore.getState()
      const pitch = startingPitch(d, s.features, { sections: store.sections, elements: store.elements, modelCenter: store.modelCenter })
      return { revolveDraft: { ...d, pitch, angleDeg: d.angleDeg >= FULL_TURN_DEG ? 3 * FULL_TURN_DEG : d.angleDeg } }
    }),
  cancelRevolve: () => set((s) => ({ revolveDraft: null, preview: { status: 'idle' }, gripField: null, ...(s.revolveDraft?.featureId !== undefined ? { buildVersion: s.buildVersion + 1 } : {}) })),
  commitRevolve: () => {
    const s = get()
    const d = s.revolveDraft
    if (!d || !revolveDraftReady(d)) return null
    if (d.featureId !== undefined) {
      const id = d.featureId
      set({
        ...remember(s),
        features: s.features.map((f) =>
          f.id === id && f.kind === 'revolve'
            ? withExprs({ ...withoutCoil(withoutTarget(f)), name: d.name?.trim() || f.name, sketchId: d.sketchId!, regions: [...d.regions], axis: d.axis!, angleDeg: d.angleDeg, ...coilOf(d), op: d.op }, d.exprs)
            : f,
        ),
        revolveDraft: null,
        preview: { status: 'idle' },
        gripField: null,
        buildVersion: s.buildVersion + 1,
      })
      return id
    }
    const id = s.nextFeatureId
    const { name, nextOfKind } = nameFor(s, d.pitch ? 'coil' : 'revolve')
    set({
      ...remember(s),
      features: [
        ...hideSketches(s.features, [d.sketchId!]),
        { id, kind: 'revolve', name: d.name?.trim() || name, sketchId: d.sketchId!, regions: [...d.regions], axis: d.axis!, angleDeg: d.angleDeg, ...coilOf(d), op: d.op, ...(d.exprs ? { exprs: d.exprs } : {}), visible: true },
      ],
      nextFeatureId: id + 1,
      nextOfKind,
      revolveDraft: null,
      preview: { status: 'idle' },
      gripField: null,
      buildVersion: s.buildVersion + 1,
    })
    return id
  },

  toggleDraftRegion: (sketchId, key) =>
    set((s) => {
      const toggle = <T extends { sketchId: number | null; regions: string[] }>(d: T): T => {
        if (d.sketchId !== sketchId) return { ...d, sketchId, regions: [key] }
        return { ...d, regions: d.regions.includes(key) ? d.regions.filter((k) => k !== key) : [...d.regions, key] }
      }
      if (s.extrudeDraft) return { extrudeDraft: toggle(s.extrudeDraft) }
      if (s.revolveDraft) return { revolveDraft: toggle(s.revolveDraft) }
      return {}
    }),
  pickAllDraftRegions: () =>
    set((s) => {
      const d = s.extrudeDraft ?? s.revolveDraft
      if (!d || d.sketchId === null) return {}
      const sketch = s.features.find((f): f is SketchFeature => f.kind === 'sketch' && f.id === d.sketchId)
      if (!sketch) return {}
      const all = findRegions(sketch.sketch).map((r) => r.key)
      const regions = all.length > 0 && all.every((k) => d.regions.includes(k)) ? [] : all
      return s.extrudeDraft ? { extrudeDraft: { ...s.extrudeDraft, regions } } : { revolveDraft: { ...s.revolveDraft!, regions } }
    }),
})
