// SPDX-License-Identifier: AGPL-3.0-only
// The Extrude box: the profiles picked, the extent from and to the sketch's
// plane or a face, the taper, the direction and the body operation, with
// the preview and the live map.

import { useLength } from '../../../src/app/useUnits'
import { Icon } from '../../../src/ui/icons'
import { InfoDot } from '../../../src/ui/InfoDot'
import { NameField } from '../../../src/ui/RefSelect'
import type { FaceRef, PlaneRef, SketchFeature } from '../core/features'
import { MAX_TAPER_DEG } from '../core/preview'
import { describeFaceIn } from '../core/topo'
import { extrudeDraftReady, useReverse } from '../state/reStore'
import { ExtrudeDistanceFields } from './ExtrudeDistanceFields'
import { DirectionField } from './DirectionField'
import { AnalysisRow, Num, OpFields, PreviewLine, ProfilesField, useRegionCount } from './featureFields'
import { PlaneSelect } from './PlaneSelect'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useShell } from '../../../src/state/shellStore'
import { useGripLabels } from '../state/gripLabelStore'
import { useRePrefs } from '../state/rePrefs'

/** QUICKSURFACE's Snapping box on an extrude: with it ticked, an end arrow
 *  dragged over the scan goes through the scan point under the cursor. The
 *  choice is kept between sessions; off by default, as there. */
function SnappingRow() {
  const on = useRePrefs((s) => s.extrudeSnap)
  const setOn = useRePrefs((s) => s.setExtrudeSnap)
  return (
    <label className="checkrow">
      <input type="checkbox" data-test="extrude-snapping" checked={on} onChange={(e) => setOn(e.target.checked)} />
      <span>
        Snapping
        <InfoDot title="Snapping">
          <p>Drag an end arrow over the scan and the end goes through the scan point under the cursor, marked with a yellow dot. Off the scan the arrow drags freely.</p>
        </InfoDot>
      </span>
    </label>
  )
}

export function ExtrudeEditor() {
  const labelsShown = useGripLabels((s) => s.shown)
  const [sketchOnSaid, setSketchOnSaid] = useState<string | null>(null)
  const draft = useReverse((s) => s.extrudeDraft)
  const features = useReverse((s) => s.features)
  const bodies = useReverse((s) => s.bodies)
  const preview = useReverse((s) => s.preview)
  const len = useLength()
  const describeFace = describeFaceIn(len.units)
  const re = useReverse
  const sketches = features.filter((f): f is SketchFeature => f.kind === 'sketch')
  const sketch = sketches.find((s) => s.id === draft?.sketchId)
  const found = useRegionCount(sketch)
  const box = useRef<HTMLDivElement | null>(null)
  const open = draft !== null
  const picked = draft?.regions.length ?? 0
  // To takes the keys as the box opens, its number selected to be typed
  // over, and again once a profile is picked on the part — never from
  // another field the operator is in.
  useEffect(() => {
    if (!open) return
    const active = document.activeElement
    if (active instanceof HTMLElement && (active.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(active.tagName))) return
    const to = box.current?.querySelector<HTMLInputElement>('input[data-test="extrude-to"]')
    to?.focus()
    to?.select()
  }, [open, draft?.featureId, picked])
  if (!draft) return null
  const set = (patch: Partial<NonNullable<typeof draft>>) => re.getState().setExtrude(patch)
  const create = () => {
    re.getState().setHint(null)
    re.getState().commitExtrude()
  }
  const extent = draft.extent
  // The distance an extent switched to starts at: 10 mm, or half an inch.
  const start = len.fromDisplay(len.step(10))
  // A join or a cut needs a body made before this feature — a solid one: a
  // sheet or a fitted surface has no inside to add to or take from.
  const targets = bodies.filter((b) => b.id !== draft.featureId && !b.surface)
  const ready = extrudeDraftReady(draft)
  return (
    <div className="draftbox" data-test="extrude-editor" ref={box}>
      <div className="sec-head">{draft.featureId !== undefined ? `Edit ${draft.name}` : 'New extrude'}</div>
      {draft.featureId !== undefined && <NameField value={draft.name ?? ''} testId="extrude-name" onChange={(name) => set({ name })} />}
      {draft.face ? (
        <div className="field">
          <span>
            Profile
            <InfoDot title="A face pulled">
              <p>
                The face itself is the profile: it is found again on the body whenever this extrude is built, and pulled as it stands then — an earlier feature that reshapes the face reshapes what is pulled from it. Nothing is copied into a sketch.
              </p>
            </InfoDot>
          </span>
          <span className="picked" data-test="extrude-face-profile">
            {describeFace(draft.face.face)} of {bodies.find((b) => b.id === draft.face!.body)?.name ?? features.find((f) => f.id === draft.face!.body)?.name ?? 'the body'}
          </span>
        </div>
      ) : (
        <>
          <label className="field">
            <span>Sketch</span>
            <select data-test="extrude-sketch" value={draft.sketchId ?? ''} onChange={(e) => set({ sketchId: e.target.value === '' ? null : Number(e.target.value) })}>
              <option value="">Select…</option>
              {sketches.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {draft.surface ? (
            <p className="hint" data-test="extrude-surface-hint">The sketch’s lines and curves are extruded as a surface{found === 0 ? ' — it closes no region' : ''}.</p>
          ) : (
            <ProfilesField picked={draft.regions.length} found={found} testPrefix="extrude" />
          )}
        </>
      )}
      {!draft.surface && <PreviewLine preview={preview} testPrefix="extrude" />}
      <AnalysisRow testPrefix="extrude" />
      <SnappingRow />
      {(() => {
        // QUICKSURFACE's Solid box: ticked, the closed regions as a solid;
        // unticked, the sketch's pieces — an open chain will do — as a
        // surface. Offered for a new extrude off a sketch by a length.
        const canSurface = draft.featureId === undefined && !draft.face && draft.sketchId !== null && (extent.kind === 'distance' || extent.kind === 'symmetric') && draft.draftDeg === 0 && !draft.direction
        const mustSurface = canSurface && found === 0
        const why = draft.featureId !== undefined
          ? 'An extrude already made keeps what it is: a solid here, a surface under Sheet.'
          : !canSurface
            ? 'A surface is extruded off a sketch, straight, by a distance or symmetric.'
            : mustSurface
              ? 'The sketch closes no region, so it extrudes as a surface.'
              : 'Ticked: the closed regions as a solid. Unticked: the sketch’s lines and curves as a surface.'
        return (
          <label className="checkrow" title={why}>
            <input type="checkbox" data-test="extrude-solid" checked={!draft.surface} disabled={!canSurface || mustSurface} onChange={(e) => set({ surface: !e.target.checked })} />
            <span>Solid</span>
          </label>
        )
      })()}
      <label className="checkrow" title="The words by the grips in the view">
        <input type="checkbox" data-test="extrude-labels" checked={labelsShown} onChange={(e) => useGripLabels.getState().setShown(e.target.checked)} />
        <span>Labels</span>
      </label>
      <GripLabels />
      {!draft.surface && !draft.face && draft.sketchId !== null && extent.kind === 'distance' && !draft.direction && (
        <div className="field" data-test="extrude-sketch-on">
          <span title="Move the sketch along its normal onto that end of the body. The body stays where it is; the depths are re-read from the sketch's new place.">Set sketch on</span>
          <span className="toolrow">
            {(['top', 'bottom'] as const).map((end) => (
              <button
                key={end}
                data-test={`extrude-sketch-on-${end}`}
                onClick={() => {
                  const why = re.getState().setExtrudeSketchOn(end)
                  setSketchOnSaid(why)
                }}
              >
                {end === 'top' ? 'Top plane' : 'Bottom plane'}
              </button>
            ))}
          </span>
        </div>
      )}
      {sketchOnSaid && <p className="hint refused" data-test="extrude-sketch-on-said">{sketchOnSaid}</p>}
      <label className="field">
        <span>Extent</span>
        <select
          data-test="extrude-extent"
          value={extent.kind}
          onChange={(e) => {
            const kind = e.target.value as typeof extent.kind
            set({
              extent:
                kind === 'distance'
                  ? { kind, from: 0, to: start }
                  : kind === 'symmetric'
                    ? { kind, total: start }
                    : kind === 'toPlane'
                      ? { kind, from: 0, plane: null as unknown as PlaneRef }
                      : kind === 'toFace'
                        ? { kind, from: 0, body: -1, face: null as unknown as FaceRef }
                        : kind === 'toBody'
                          ? { kind, from: 0, body: -1 }
                          : kind === 'toNext' || kind === 'toLast'
                          ? { kind, from: 0 }
                          : { kind: 'betweenPlanes', a: null as unknown as PlaneRef, b: null as unknown as PlaneRef },
            })
          }}
        >
          <option value="distance">Two-sided</option>
          <option value="toPlane" disabled={!!draft.surface}>To a plane</option>
          <option value="toFace" disabled={!!draft.surface}>To a face of a body</option>
          <option value="toBody" disabled={!!draft.surface}>To a body</option>
          <option value="toNext" disabled={!!draft.surface}>To next</option>
          <option value="toLast" disabled={!!draft.surface}>To last / through all</option>
          <option value="betweenPlanes" disabled={!!draft.surface}>Between two planes</option>
          <option value="symmetric">Mirrored</option>
        </select>
      </label>
      <div className="toolrow">
        <button
          className="withicon"
          data-test="extrude-flip"
          disabled={extent.kind !== 'distance' && extent.kind !== 'toNext' && extent.kind !== 'toLast' && extent.kind !== 'toBody'}
          title={
            extent.kind === 'distance'
              ? 'Extrude the other way along the sketch plane’s normal — From and To change sign, and the ghost turns over'
              : extent.kind === 'toNext' || extent.kind === 'toLast' || extent.kind === 'toBody'
                ? 'Look for the body the other way along the sketch plane’s normal'
              : extent.kind === 'symmetric'
                ? 'A symmetric extrude has no direction to reverse'
                : 'An extrude limited by a plane reaches the way the plane lies'
          }
          onClick={() => re.getState().flipExtrude()}
        >
          <Icon name="flip" size={16} />
          Reverse direction
        </button>
      </div>
      {extent.kind === 'distance' && (
        <ExtrudeDistanceFields key={draft.featureId ?? 'new'} extent={extent} exprs={draft.exprs}
          onExtent={(next) => set({ extent: next })} onCreate={create} />
      )}
      {extent.kind === 'symmetric' && (
        <>
          <Num label="Total" testId="extrude-total" slot="extent.total" value={extent.total} nominal="length" onCommit={(v) => set({ extent: { ...extent, total: v } })} hint="The whole thickness, half on each side of the sketch plane; either arrow drags it" />
          <p className="hint" data-test="extrude-pick-hint">
            Or click a point on the part: each half reaches it.
          </p>
        </>
      )}
      {extent.kind === 'toPlane' && (
        <>
          <Num label="From" testId="extrude-from" slot="extent.from" value={extent.from} nominal="length" onCommit={(v) => set({ extent: { ...extent, from: v } })} hint="How far along the normal the body starts" />
          <label className="field">
            <span>Up to</span>
            <PlaneSelect value={extent.plane} testId="extrude-plane" placeholder="Choose the plane…" onChange={(plane) => set({ extent: { ...extent, plane } })} />
          </label>
        </>
      )}
      {extent.kind === 'toFace' && (
        <>
          <Num label="From" testId="extrude-from" slot="extent.from" value={extent.from} nominal="length" onCommit={(v) => set({ extent: { ...extent, from: v } })} hint="How far along the normal the body starts" />
          <div className="field">
            <span>Up to</span>
            <span className="picked" data-test="extrude-to-face">
              {extent.face ? describeFace(extent.face) : 'Click a face of a body'}
            </span>
          </div>
        </>
      )}
      {extent.kind === 'toBody' && (
        <>
          <Num label="From" testId="extrude-from" slot="extent.from" value={extent.from} nominal="length" onCommit={(v) => set({ extent: { ...extent, from: v } })} hint="How far along the normal the body starts" />
          <label className="field">
            <span>Up to</span>
            <select data-test="extrude-to-body" value={extent.body >= 0 ? extent.body : ''} onChange={(e) => set({ extent: { ...extent, body: e.target.value === '' ? -1 : Number(e.target.value) } })}>
              <option value="">Choose the body…</option>
              {bodies
                .filter((b) => b.id !== draft.featureId)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
          </label>
          <p className="hint" data-test="extrude-until">Runs until the profile meets the body’s surface — a solid’s skin or a sheet — the way the body lies; the body has to lie under the whole profile.</p>
        </>
      )}
      {(extent.kind === 'toNext' || extent.kind === 'toLast') && (
        <>
          <Num label="From" testId="extrude-from" slot="extent.from" value={extent.from} nominal="length" onCommit={(v) => set({ extent: { ...extent, from: v } })} hint="How far along the normal the body starts" />
          <p className="hint" data-test="extrude-until">
            {extent.kind === 'toNext'
              ? draft.op === 'cut'
                ? 'Cuts through the first wall of the body the profile meets, and stops where it comes out.'
                : 'Runs until the profile meets the body — the whole profile has to land on it. Reverse direction looks the other way.'
              : draft.op === 'cut'
                ? 'Cuts through all of the body that way.'
                : 'Runs to the far end of the body that way.'}
            {draft.op === 'new' && ' Measured against every body there is.'}
          </p>
        </>
      )}
      {extent.kind === 'betweenPlanes' && (
        <>
          <label className="field">
            <span>From plane</span>
            <PlaneSelect value={extent.a} testId="extrude-plane-a" placeholder="Choose the plane…" onChange={(a) => set({ extent: { ...extent, a } })} />
          </label>
          <label className="field">
            <span>To plane</span>
            <PlaneSelect value={extent.b} testId="extrude-plane-b" placeholder="Choose the plane…" onChange={(b) => set({ extent: { ...extent, b } })} />
          </label>
        </>
      )}
      {/* Fusion's taper: positive leans the sides out. The feature keeps a
          mould's draft, positive leaning in — the same number turned over.
          A surface is swept straight and joins nothing: no taper, direction
          or result to give. */}
      {!draft.surface && (<>
      <Num
        label="Taper"
        unit="°"
        testId="extrude-taper" slot="taper"
        value={draft.draftDeg === 0 ? 0 : -draft.draftDeg}
        nominal="angle"
        onCommit={(v) => set({ draftDeg: v === 0 ? 0 : -Math.max(-MAX_TAPER_DEG, Math.min(MAX_TAPER_DEG, v)) })}
        hint="Degrees the sides lean as the extrude goes away from the sketch, as Fusion's taper angle: positive leans them out, negative leans them in — a moulded boss's draft. 0 for straight sides. The sketch's outline stays the section at the sketch plane, or at the end of the extent nearest it, and an extrude reaching both ways leans both ways from there. The arrow on the far edge drags it. A taper that would close the profile before the end is refused, saying where it closes."
      />
      <DirectionField direction={draft.direction} normal={draft.face ? draft.face.face.dir : (sketch?.frame.normal ?? null)} onChange={(direction) => set({ direction })} />
      <OpFields op={draft.op} canCut={targets.length > 0} testPrefix="extrude" onOp={(op) => re.getState().setExtrudeOp(op)} />
      </>)}
      <button className="primary block" data-test="extrude-create" disabled={!ready} title="Enter or a middle click does the same" onClick={create}>
        {draft.featureId !== undefined ? 'Save changes' : draft.surface ? 'Create surface' : 'Create extrude'}
      </button>
      <div className="toolrow">
        <button data-test="extrude-cancel" onClick={() => { re.getState().setHint(null); re.getState().cancelExtrude() }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

/** The grips' words, boxed by them in the view and following it as it turns. */
function GripLabels() {
  const labels = useGripLabels((s) => s.labels)
  const shown = useGripLabels((s) => s.shown)
  const [, redraw] = useState(0)
  useEffect(() => {
    if (!shown || labels.length === 0) return
    let id = 0
    const tick = () => { redraw((n) => n + 1); id = requestAnimationFrame(tick) }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [shown, labels])
  const at = useShell.getState().screenPointOf
  if (!shown || !at || labels.length === 0) return null
  return createPortal(
    <>
      {(() => {
        // Seen along the extrude the two grips fall together: the second
        // label steps down clear of the first, as QUICKSURFACE keeps them.
        const placed: { x: number; y: number }[] = []
        return [...labels].sort((a, b) => Number(b.text.startsWith('Top')) - Number(a.text.startsWith('Top'))).map((l) => {
          // By the arrow as it is drawn — it slides along its face to stay in
          // view when zoomed in past where it stands.
          const p = at((l.side ? useShell.getState().gripPointOf?.(l.side) : null) ?? l.at)
          if (!p) return null
          let y = p.y
          while (placed.some((q) => Math.abs(q.x - p.x) < 160 && Math.abs(q.y - y) < 22)) y += 24
          placed.push({ x: p.x, y })
          return (
            <div key={l.text} className="grip-label" data-test="extrude-grip-label"
              style={{ position: 'fixed', left: p.x + 14, top: y, transform: 'translateY(-50%)', background: 'var(--panel, #1e2126)', color: 'var(--ink, #e8eaed)', border: '1px solid var(--line, #3a3f47)', padding: '1px 6px', fontSize: 12, whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 45 }}>
              {l.text}
            </div>
          )
        })
      })()}
    </>,
    document.body,
  )
}
