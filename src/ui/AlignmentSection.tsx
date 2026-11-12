// SPDX-License-Identifier: AGPL-3.0-only
// The alignment group: the 3-2-1 datum editor, the manual move / rotate box,
// and the buttons that open them.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ALIGN_PICK_COUNT,
  axisIndex,
  manualRigid,
  type AxisDir,
} from '../core/alignment'
import { rigidApply, rigidRotate, type Rigid } from '../core/deviation/rigid'
import type { Vec3 } from '../core/types'
import { useShell } from '../state/shellStore'
import type { RefRole } from '../core/elements/refs'
import {
  alignCenterOf,
  alignmentPreview,
  alignSlotPicks,
  useStore,
  type Element,
} from '../state/store'
import { alignDraftTertiaryTiles, alignmentReferences, alignmentTileAxis, chosenTertiaryTile } from '../state/alignModel'
import { secondaryAlongPrimary } from '../core/alignment'
import { InfoDot } from './InfoDot'
import { providersFor } from './RefSelect'
import { useLength } from '../app/useUnits'

/** Heading of one alignment step, worded as QUICKSURFACE's dialog. */
function StepHead({ text }: { text: string }) {
  return <div className="stephead">{text}</div>
}

/** QUICKSURFACE's three tiles for what the primary feature becomes. Flip
 *  turns the chosen one to the opposite side. */
const PLANE_TILES: { label: string; axis: AxisDir }[] = [
  { label: 'Top', axis: 'z+' },
  { label: 'Right', axis: 'x+' },
  { label: 'Front', axis: 'y+' },
]

/** What an axis becomes, as QUICKSURFACE lists them for a cylinder, cone or
 *  line taken as primary: X Axis, Y Axis, Z Axis — Z by default. */
const AXIS_TILES: { label: string; axis: AxisDir }[] = [
  { label: 'X Axis', axis: 'x+' },
  { label: 'Y Axis', axis: 'y+' },
  { label: 'Z Axis', axis: 'z+' },
]

/** The six inputs of the manual move / rotate box, in the order the values
 *  are stored. A move is a length, typed in the units shown. */
const MANUAL_FIELDS = [
  { key: 'mx', label: 'Move X', unit: 'length' },
  { key: 'my', label: 'Move Y', unit: 'length' },
  { key: 'mz', label: 'Move Z', unit: 'length' },
  { key: 'rx', label: 'Rotate about X', unit: '°' },
  { key: 'ry', label: 'Rotate about Y', unit: '°' },
  { key: 'rz', label: 'Rotate about Z', unit: '°' },
] as const

/** One alignment slot: an existing element, or the option to fill the slot by
 *  clicking points straight on the scan. */
function AlignSelect({
  label,
  roles,
  value,
  picks,
  need,
  picking,
  elements,
  testId,
  onChange,
  onPick,
  onReferencePick,
  referencePicking,
  onFlip,
  flipDisabled = false,
  flipPressed,
}: {
  label: string
  roles: readonly RefRole[]
  value: number | null
  /** Points already picked for this slot. */
  picks: number
  /** Points a pick-fill needs. */
  need: number
  picking: boolean
  elements: Element[]
  testId: string
  onChange: (id: number | null) => void
  onPick: () => void
  onReferencePick: () => void
  referencePicking: boolean
  onFlip?: () => void
  /** Shown but unavailable — the tertiary feature, as QUICKSURFACE greys it for a point. */
  flipDisabled?: boolean
  /** A Flip that stays pressed, as the tertiary's does in QUICKSURFACE. */
  flipPressed?: boolean
}) {
  const options = providersFor(roles, alignmentReferences(elements))
  const selectValue = picking
    ? '__pick__'
    : value !== null
      ? String(value)
      : picks >= need
        ? '__picked__'
        : ''
  return (
    <div className="field">
      <span>{label}</span>
      <select
        data-test={testId}
        value={selectValue}
        onChange={(e) => {
          if (e.target.value === '__pick__') onPick()
          else if (e.target.value !== '__picked__')
            onChange(e.target.value === '' ? null : Number(e.target.value))
        }}
      >
        <option value="">Select…</option>
        {picks >= need && !picking && (
          <option value="__picked__">
            {need === 1 ? 'Picked point ✓' : `${need} picked points ✓`}
          </option>
        )}
        {options.map((el) => (
          <option key={el.id} value={el.id}>
            {el.name}
          </option>
        ))}
        <option value="__pick__">
          {picking
            ? `Picking — ${picks} / ${need} on the scan…`
            : `+ Pick ${need === 1 ? 'a point' : `${need} points`} on the scan…`}
        </option>
      </select>
      <button type="button" data-test={`${testId}-pick`} aria-pressed={referencePicking} onClick={onReferencePick}>{referencePicking ? 'Picking…' : 'Pick…'}</button>
      {onFlip && <button type="button" data-test={`${testId}-flip`} disabled={flipDisabled || (value === null && picks < need)} aria-pressed={flipPressed} className={flipPressed ? 'on' : undefined} onClick={onFlip}>Flip</button>}
    </div>
  )
}

export function AlignmentSection({
  onAutoAlign,
  onAlignSymmetry,
  onStartAlignment,
  onApplyAlignment,
  onApplyManual,
  onResetAlignment,
}: {
  /** Ask the scan for a proposal and open the editor on it. */
  onAutoAlign: () => void
  /** Settle the pose being set up on the scan's own symmetry plane. */
  onAlignSymmetry: () => void
  onStartAlignment: () => void
  /** Bake the computed datum alignment into the part. */
  onApplyAlignment: (m: Rigid) => Promise<boolean>
  /** Bake a typed-in move / rotate into the part. */
  onApplyManual: (m: Rigid) => void
  onResetAlignment: () => void
}) {
  const fileName = useStore((s) => s.fileName)
  const busy = useStore((s) => s.busy)
  const elements = useStore((s) => s.elements)
  const modelSize = useStore((s) => s.modelSize)
  const alignDraft = useStore((s) => s.alignDraft)
  const appliedAlignment = useStore((s) => s.appliedAlignment)
  const cancelAlignment = useStore((s) => s.cancelAlignment)
  const setAlignmentRef = useStore((s) => s.setAlignmentRef)
  const setAlignmentAxis = useStore((s) => s.setAlignmentAxis)
  const beginAlignmentPick = useStore((s) => s.beginAlignmentPick)
  const undoAlignmentPick = useStore((s) => s.undoAlignmentPick)

  // The manual move / rotate box: six typed-in numbers, NaN while a field is
  // empty. Purely local — it needs no viewport interaction.
  // Held as typed — the moves in the units shown — and turned into
  // millimetres when applied.
  const [manual, setManual] = useState<number[] | null>(null)
  // Translate X / Y / Z, typed in the units shown, added after the alignment.
  const [shift, setShift] = useState(['0', '0', '0'])
  const draftOpen = alignDraft !== null
  // Apply closes the draft in the store and reopens it here so the panel stays
  // up; that reopening is not the panel opening, so it must not replace the
  // "Part aligned" report with the opening hint.
  // When React renders the close and the reopen together nothing fires, so the
  // mark is a time, not a flag that could linger to the next real opening.
  const reopenedByApply = useRef(0)
  useEffect(() => {
    if (!draftOpen) return
    setShift(['0', '0', '0'])
    const fresh = performance.now() - reopenedByApply.current < 1000
    reopenedByApply.current = 0
    if (fresh) return
    useStore.getState().setStatus('Choose the primary, secondary and tertiary features that define the coordinate system, then press Apply.')
  }, [draftOpen])
  const len = useLength()
  // The fits in the primary and secondary slots, when they are elements: a
  // primary axis lists X / Y / Z Axis, and a secondary running its way can
  // only stand on the primary's own axis — the other tiles go grey.
  const refs = alignmentReferences(elements)
  const primaryFit = alignDraft?.primary != null ? refs.find((e) => e.id === alignDraft.primary)?.fit ?? null : null
  const secondaryFit = alignDraft?.secondary != null ? refs.find((e) => e.id === alignDraft.secondary)?.fit ?? null : null
  const primaryIsAxis = !!primaryFit && (primaryFit.kind === 'cylinder' || primaryFit.kind === 'cone' || primaryFit.kind === 'line')
  const primaryTiles = primaryIsAxis ? AXIS_TILES : PLANE_TILES
  const secondaryAlong = !!primaryFit && !!secondaryFit && secondaryAlongPrimary(primaryFit, secondaryFit)
  // QUICKSURFACE names what an axis secondary (a cylinder, cone or line) becomes as it names an axis primary: X Axis, Y Axis, Z Axis (basic_part, 2026-11-11).
  const secondaryIsAxis = secondaryFit?.kind === 'cylinder' || secondaryFit?.kind === 'cone' || secondaryFit?.kind === 'line'
  // A secondary running the primary's way takes the primary's own axis, as
  // QUICKSURFACE selects it (Top for a cylinder standing on Z Axis); one that
  // was there and no longer runs that way moves off it.
  const primaryAxisNow = alignDraft?.primaryAxis
  const secondaryAxisNow = alignDraft?.secondaryAxis
  useEffect(() => {
    if (!primaryAxisNow || !secondaryAxisNow) return
    const same = axisIndex(secondaryAxisNow) === axisIndex(primaryAxisNow)
    if (secondaryAlong && !same) setAlignmentAxis('secondary', primaryAxisNow)
  }, [secondaryAlong, primaryAxisNow, secondaryAxisNow, secondaryFit, setAlignmentAxis])
  // QUICKSURFACE's tertiary row: its tiles turn the part only when the
  // secondary runs the primary's way (see tertiaryTiles).
  const tertiary = alignDraft ? alignDraftTertiaryTiles(alignDraft, elements, modelSize) : null
  const tertiaryTile = alignDraft && tertiary ? chosenTertiaryTile(alignDraft, tertiary) : null
  const tertiaryFilled = !!alignDraft && (alignDraft.origin !== null || alignDraft.originPicks.length >= ALIGN_PICK_COUNT.origin)
  const manualNums = manual?.map((v) => (Number.isFinite(v) ? v : 0)) ?? null
  const manualIdentity = manualNums === null || manualNums.every((v) => v === 0)

  // The transform the alignment being set up would apply, or why it cannot be
  // computed yet — the same reading the viewport is previewing the part with.
  // Memoised for the same reason as the dimensions: it is a whole datum
  // alignment, recomputed only when one of its inputs actually moves.
  const centerOf = useStore(alignCenterOf)
  const { preview: alignReady, error: alignError } = useMemo(
    () =>
      alignDraft
        ? alignmentPreview(alignDraft, elements, modelSize, centerOf)
        : { preview: null, error: null },
    [alignDraft, elements, modelSize, centerOf],
  )

  return (
    <div className="group">
      <div className="sec-head">
        Alignment
        <InfoDot title="Alignment">
          <p>
            Where X, Y, Z and the zero point sit on the part. Until it is set the scan lies in
            whatever pose the scanner left it in, so heights, offsets and anything measured
            against an axis mean nothing.
          </p>
          <p>
            <b>Auto-align</b> reads the pose off the scan itself: the directions most of its faces
            are square to, the axis its round walls run along, and the side it stood on — an open
            scan is open where it sat, and a flat rim it ends in counts as the face that is
            missing. It opens the
            same three steps filled in, previewed on the part — change which side is down or which
            way X runs, or replace a step, before anything is applied. A part with no flat faces
            and no round walls gets its principal axes, which is a guess.
          </p>
          <p>
            <b>Align part</b> places it in up to three steps — set a face on a coordinate plane,
            run an edge or a bore along an axis, put the zero point on a corner. Each step takes a
            measured element — the accurate choice, it averages thousands of scan points — or
            points clicked straight on the scan, and the viewport previews every choice against
            the coordinate planes before anything is applied.
          </p>
          <p>
            <b>Use symmetry</b>, in the Align part box, settles the pose on the part’s own mirror
            plane: the plane is searched for on the scan — or taken from a symmetry plane already
            measured — the axis nearest its normal is turned onto it, and the zero point is put on
            it. The plane is then a coordinate plane of the part, which is what a sketch on the
            middle and a Mirror want. With no pose set up yet it starts from Auto-align’s.
          </p>
          <p>
            <b>Move / rotate by numbers</b> applies a transform you already know instead. Both are
            baked into the part, and <b>Reset alignment</b> puts it back.
          </p>
        </InfoDot>
      </div>
      {alignDraft === null && manual !== null ? (
        <div className="draftbox">
          <div className="sec-head">
            Move / rotate part
            <InfoDot title="Move / rotate part">
              <p>
                How far to move the part ({len.word()}) and how far to turn it (°) along the global axes.
              </p>
              <p>
                It turns about the zero point first — about X, then Y, then Z — and moves after
                that, so a rotation and an offset entered together behave the same way every time.
              </p>
            </InfoDot>
          </div>
          {MANUAL_FIELDS.map((f, i) => (
            <label className="field" key={f.key}>
              <span>
                {f.label} ({f.unit === 'length' ? len.word() : f.unit})
              </span>
              <input
                type="number"
                step="any"
                data-test={`manual-${f.key}`}
                value={Number.isFinite(manual[i]) ? manual[i] : ''}
                onChange={(e) =>
                  setManual(
                    manual.map((v, j) =>
                      j === i ? (e.target.value === '' ? NaN : Number(e.target.value)) : v,
                    ),
                  )
                }
              />
            </label>
          ))}
          <button
            className="primary block"
            data-test="apply-manual"
            disabled={manualIdentity || busy}
            onClick={() => {
              if (!manualNums) return
              onApplyManual(
                manualRigid(
                  [len.fromDisplay(manualNums[0]), len.fromDisplay(manualNums[1]), len.fromDisplay(manualNums[2])],
                  [manualNums[3], manualNums[4], manualNums[5]],
                ),
              )
              setManual(null)
            }}
          >
            Move part
          </button>
          <div className="toolrow">
            <button data-test="cancel-manual" onClick={() => setManual(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : alignDraft === null ? (
        <>
          <button
            className="block"
            data-test="auto-align"
            disabled={!fileName || busy}
            onClick={onAutoAlign}
          >
            Auto-align
          </button>
          <button
            className="block"
            data-test="start-alignment"
            disabled={!fileName || busy}
            onClick={onStartAlignment}
          >
            Align part
          </button>
          <button
            className="block"
            data-test="start-manual"
            disabled={!fileName || busy}
            onClick={() => setManual([NaN, NaN, NaN, NaN, NaN, NaN])}
          >
            Move / rotate by numbers
          </button>
          {appliedAlignment !== null && (
            <button
              className="block"
              data-test="reset-alignment"
              disabled={busy}
              onClick={onResetAlignment}
            >
              Reset alignment
            </button>
          )}
        </>
      ) : (
        <div className="draftbox">
          <div className="sec-head">
            Align part
            <InfoDot title="Align part">
              <p>
                Three steps, and only the first is required. The coordinate planes in the viewport
                are where the part is going; it moves live with every choice, and nothing is
                applied until <b>Confirm alignment</b> is pressed.
              </p>
              <p>
                <b>1 · Set on a plane</b> — use a measured plane or cylinder, or pick 3 points
                on one face of the part. Then say which side of the part that face is: the
                bottom lands on the floor plane, a front lands on the front plane, and so on.
              </p>
              <p>
                <b>2 · Align with an axis</b> — use a measured plane or cylinder (its normal or
                its axis is the direction), or pick 2 points along an edge, and say which way
                that direction should run, so the part cannot spin on the plane. An element
                averages thousands of scan points where a pick is one spot of noise, so fit the
                face or the bore first when the direction has to hold. Picked, the edge runs
                from your 1st point to your 2nd.
              </p>
              <p>
                <b>3 · Move to zero point</b> — pick the corner or feature that becomes X0 Y0 Z0.
                A zero point on its own works too, if all you want is to move the origin.
              </p>
              <p>
                Whatever a step already fixes it also zeroes — a face set on the floor sits at
                height 0 — and the first alignment centres the part on whatever is still free.
              </p>
            </InfoDot>
          </div>
          {alignDraft.proposal && (
            <p className="hint" data-test="align-proposal">
              {alignDraft.proposal}
            </p>
          )}
          <div className="toolrow" style={{ justifyContent: 'flex-end' }}>
            <button
              data-test="align-reset"
              onClick={() => {
                const st = useStore.getState()
                for (const slot of ['primary', 'secondary', 'origin'] as const) st.setAlignmentRef(slot, null)
                useStore.setState((x) => (x.alignDraft ? { alignDraft: { ...x.alignDraft, tertiaryAxis: undefined, tertiaryFlip: false } } : {}))
                st.beginAlignmentReferencePick('primary')
                setShift(['0', '0', '0'])
              }}
            >
              Reset
            </button>
          </div>
          <StepHead text="Primary feature" />
          <AlignSelect
            label={primaryIsAxis ? 'Axis' : 'Face'}
            roles={['plane', 'axis']}
            value={alignDraft.primary}
            picks={alignDraft.primaryPicks.length}
            need={ALIGN_PICK_COUNT.primary}
            picking={alignDraft.pickSlot === 'primary'}
            elements={elements}
            testId="align-primary"
            onChange={(id) => setAlignmentRef('primary', id)}
            onPick={() => beginAlignmentPick('primary')}
            onReferencePick={() => useStore.getState().beginAlignmentReferencePick('primary')}
            referencePicking={alignDraft.referencePickSlot === 'primary'}
            onFlip={() => useStore.getState().flipAlignmentAxis('primary')}
          />
          {(alignDraft.primary !== null || alignDraft.primaryPicks.length >= ALIGN_PICK_COUNT.primary) && <div className="toolrow" role="group" aria-label="Primary feature becomes" data-test="align-primary-tiles">
            {primaryTiles.map((t) => (
              <button
                key={t.label}
                data-test={`align-tile-${t.label.toLowerCase().replace(' ', '-')}`}
                aria-pressed={axisIndex(alignDraft.primaryAxis) === axisIndex(t.axis)}
                className={axisIndex(alignDraft.primaryAxis) === axisIndex(t.axis) ? 'on' : undefined}
                onClick={() => setAlignmentAxis('primary', t.axis)}
              >
                {t.label}
              </button>
            ))}
          </div>}
          <label className="checkline" data-test="align-keep-origin">
            <input
              type="checkbox"
              checked={Boolean(alignDraft.keepOrigin)}
              onChange={(e) => useStore.setState((st) => (st.alignDraft ? { alignDraft: { ...st.alignDraft, keepOrigin: e.target.checked } } : {}))}
            />{' '}
            Don’t move the coordinate system to the centre of the primitive
          </label>
          <StepHead text="Secondary feature" />
          <AlignSelect
            label="Direction"
            roles={['plane', 'axis']}
            value={alignDraft.secondary}
            picks={alignDraft.secondaryPicks.length}
            need={ALIGN_PICK_COUNT.secondary}
            picking={alignDraft.pickSlot === 'secondary'}
            elements={elements.filter((e) => e.id !== alignDraft.primary)}
            testId="align-secondary"
            onChange={(id) => setAlignmentRef('secondary', id)}
            onPick={() => beginAlignmentPick('secondary')}
            onReferencePick={() => useStore.getState().beginAlignmentReferencePick('secondary')}
            referencePicking={alignDraft.referencePickSlot === 'secondary'}
            onFlip={() => useStore.getState().flipAlignmentAxis('secondary')}
          />
          {(alignDraft.secondary !== null || alignDraft.secondaryPicks.length >= ALIGN_PICK_COUNT.secondary) && <div className="toolrow" role="group" aria-label="Secondary feature becomes" data-test="align-secondary-tiles">
            {/* The primary's own axis is greyed. A secondary left on it (the
                primary moved there afterwards) is ignored, as QUICKSURFACE
                ignores it (see computeDatumAlignment). */}
            {(secondaryIsAxis ? AXIS_TILES : PLANE_TILES).map(({ label, axis }) => <button key={label} type="button"
              data-test={`align-secondary-${label.toLowerCase()}`} disabled={secondaryAlong ? axisIndex(axis) !== axisIndex(alignDraft.primaryAxis) : axisIndex(axis) === axisIndex(alignDraft.primaryAxis)}
              className={axisIndex(alignDraft.secondaryAxis) === axisIndex(axis) ? 'on' : undefined}
              aria-pressed={axisIndex(alignDraft.secondaryAxis) === axisIndex(axis)}
              onClick={() => setAlignmentAxis('secondary', alignmentTileAxis(alignDraft.secondaryAxis, axis))}>{label}</button>)}
          </div>}
          <StepHead text="Tertiary feature" />
          <AlignSelect
            label="Zero point"
            roles={['point', 'plane', 'axis']}
            value={alignDraft.origin}
            picks={alignDraft.originPicks.length}
            need={ALIGN_PICK_COUNT.origin}
            picking={alignDraft.pickSlot === 'origin'}
            elements={elements}
            testId="align-origin"
            onChange={(id) => setAlignmentRef('origin', id)}
            onPick={() => beginAlignmentPick('origin')}
            onReferencePick={() => useStore.getState().beginAlignmentReferencePick('origin')}
            referencePicking={alignDraft.referencePickSlot === 'origin'}
            onFlip={() => useStore.setState((st) => (st.alignDraft ? { alignDraft: { ...st.alignDraft, tertiaryFlip: !st.alignDraft.tertiaryFlip } } : {}))}
            flipDisabled={!tertiary?.kind}
            flipPressed={Boolean(alignDraft.tertiaryFlip) && !!tertiary?.kind}
          />
          {tertiaryFilled && tertiary?.kind && <div className="toolrow" role="group" aria-label="Tertiary feature becomes" data-test="align-tertiary-tiles">
            {(tertiary.kind === 'axis' ? AXIS_TILES : PLANE_TILES).map(({ label, axis }) => <button key={label} type="button"
              data-test={`align-tertiary-${label.toLowerCase().replace(' ', '-')}`}
              disabled={!tertiary.enabled[axisIndex(axis)]}
              className={tertiaryTile === axis ? 'on' : undefined}
              aria-pressed={tertiaryTile === axis}
              onClick={() => useStore.setState((st) => (st.alignDraft ? { alignDraft: { ...st.alignDraft, tertiaryAxis: axis } } : {}))}>{label}</button>)}
          </div>}
          <div className="field" data-test="align-translate" style={{ flexWrap: "wrap", gap: 6 }}>
            <span>Translate</span>
            {(['X', 'Y', 'Z'] as const).map((axis, i) => (
              <label key={axis} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {axis}
                <input
                  type="number"
                  step="any"
                  style={{ width: 56 }}
                  data-test={`align-translate-${axis.toLowerCase()}`}
                  value={shift[i]}
                  onChange={(e) => setShift(shift.map((v, j) => (j === i ? e.target.value : v)))}
                />
              </label>
            ))}
            <button
              data-test="align-translate-pick"
              disabled={busy}
              title="Click a point on the scan: X, Y and Z are filled so that point lands on the origin after the alignment"
              onClick={() => {
                useStore.getState().setStatus('Click the point on the scan that should go to the origin.')
                const pick = (e: MouseEvent) => {
                  if (!(e.target as HTMLElement | null)?.closest?.('.desktop-mid canvas')) return
                  document.removeEventListener('click', pick, true)
                  const p = useShell.getState().scanPointAt?.(e.clientX, e.clientY)
                  if (!p) { useStore.getState().setStatus('No scan under that point — Pick… again and click on the part.'); return }
                  e.stopPropagation()
                  const at = new Float64Array(p)
                  if (alignReady) rigidApply(alignReady.rigid, p[0], p[1], p[2], at)
                  setShift([0, 1, 2].map((i) => String(Number(len.toDisplay(-at[i]).toFixed(4)))))
                  useStore.getState().setStatus('Translate set: the picked point goes to the origin when you press Apply.')
                }
                document.addEventListener('click', pick, true)
              }}
            >
              Pick …
            </button>
          </div>

          {/* The pose itself is previewed on the part, against the coordinate
              planes — the panel only has to speak up when the chosen datums
              cannot make an alignment at all. */}
          {alignError && (
            <p className="alarmtext" data-test="align-error">
              {alignError}
            </p>
          )}

          <button
            className="block"
            data-test="align-symmetry"
            disabled={busy || alignDraft.pickSlot !== null}
            title="Find the part’s mirror plane on the scan — or use a symmetry plane already measured — and settle this pose on it: the axis nearest its normal turned onto it, the zero point put on it. With nothing set up yet, Auto-align’s pose is the start. Nothing is applied until Confirm alignment is pressed"
            onClick={onAlignSymmetry}
          >
            Use symmetry
          </button>
          <button
            className="primary block"
            data-test="apply-alignment"
            data-confirm={1}
            disabled={!alignReady || busy}
            onClick={async () => {
              if (!alignReady) return
              const m = { r: alignReady.rigid.r.slice(), t: alignReady.rigid.t.slice() }
              shift.forEach((v, i) => { const n = Number(v); if (Number.isFinite(n)) m.t[i] += len.fromDisplay(n) })
              const draft = alignDraft
              if (!await onApplyAlignment(m)) return
              // Retain choices in the committed frame; never reuse a stale
              // transform or the translation typed for the previous Apply.
              reopenedByApply.current = performance.now()
              const moved = (v: Vec3, normal = false): Vec3 => {
                const out = new Float64Array(3)
                ;(normal ? rigidRotate : rigidApply)(m, ...v, out)
                return [out[0], out[1], out[2]]
              }
              useStore.setState({ alignDraft: { ...draft, pickSlot: null, referencePickSlot: null, proposal: undefined,
                primaryPicks: draft.primaryPicks.map(v => moved(v)),
                primaryPickNormals: draft.primaryPickNormals.map(v => moved(v, true)),
                secondaryPicks: draft.secondaryPicks.map(v => moved(v)),
                originPicks: draft.originPicks.map(v => moved(v)),
              } })
              setShift(['0', '0', '0'])
            }}
          >
            Apply
          </button>
          <div className="toolrow">
            {alignDraft.pickSlot !== null && (
              <button
                data-test="align-undo-pick"
                disabled={alignSlotPicks(alignDraft, alignDraft.pickSlot).length === 0}
                onClick={undoAlignmentPick}
              >
                Undo point
              </button>
            )}
            <button data-test="cancel-alignment" onClick={cancelAlignment}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
