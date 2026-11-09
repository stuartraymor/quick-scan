// SPDX-License-Identifier: AGPL-3.0-only
// The CAD workspace exposes its own actions; the shell knows no plugin state.
import { DEFAULT_SURFACE_FIT } from '../core/surfaceFit'
import { useShell } from '../../../src/state/shellStore'
import { useZebra } from '../state/zebraStore'
import type { ReactNode } from 'react'
import { Icon, type IconName } from '../../../src/ui/icons'
import { useStore } from '../../../src/state/store'
import { useDeviation } from '../../../src/state/deviationStore'
import { reEditorOpen, useReverse } from '../state/reStore'
import type { PluginRuntime } from '../../../src/plugins/api'
import { useNotes } from '../state/noteStore'
import { usePrefs } from '../../../src/state/prefsStore'
import { throughPart } from './PlaceSketch'
import { usePipeDialog } from './PipeDialog'
import { chooseFreeformObj } from './FreeformImport'
import { useAutoFreeformDialog } from './AutoFreeformDialog'
import { openWrapSurface } from './WrapSurfaceDialog'
import { reverseSession } from '../app/reSession'
import { useMark } from '../../../src/state/markStore'
import { SURFACE_MIN_REGION } from '../core/features'

/** Shared workflow buttons still call plugin-owned verbs and prerequisites. */
export function useReverseRibbonActions(onExport: () => void): NonNullable<PluginRuntime['ribbonActions']> {
  const state = useReverse()
  useMark(s => s.count)
  const busy = useStore((s) => s.busy)
  const fileName = useStore((s) => s.fileName)
  const picking = useDeviation((s) => s.picking)
  const locked = busy || state.building || state.playback !== null || picking || reEditorOpen(state)
  const ready = state.kernelStatus === 'ready'
  const sketches = state.features.filter((f) => f.kind === 'sketch').length
  const action = (run: () => void, requirement = true, reason = '') => ({
    run: () => {
      const now = useReverse.getState()
      if (locked || !requirement || now.kernelStatus !== 'ready' || now.building || reEditorOpen(now)) return
      run()
    },
    disabled: locked || !ready || !requirement,
    title: locked ? 'Finish the current operation first.' : !ready ? 'Open the CAD workspace to load the CAD kernel.' : !requirement ? reason : undefined,
  })
  return {
    // Construct → Plane from 2D sketch: the Plane editor opened on the open
    // sketch's plane, or else the last sketch's, to confirm as a typed plane.
    planeFromSketch: {
      run: () => {
        const now = useReverse.getState()
        const last = [...now.features].reverse().find((f) => f.kind === 'sketch' && 'frame' in f && f.frame) as { frame: { origin: number[]; normal: number[] } } | undefined
        const frame = now.sketchDraft?.frame ?? last?.frame
        if (!frame) { useStore.getState().setStatus('Make a 2D sketch first — its plane becomes the new plane.'); return }
        useShell.getState().setWorkspace('elements')
        const st = useStore.getState()
        st.startDraft('plane')
        st.setDraftMethod('plane-coords')
        st.setDraftParams([...frame.normal, ...frame.origin], 'The plane of the sketch — check it, then confirm.')
      },
      disabled: !state.sketchDraft && !state.features.some((f) => f.kind === 'sketch'),
      title: 'Plane from 2D sketch: a plane on the plane of a sketch',
    },
    // Construct → Plane through sketch line: the plane holding the one line
    // selected in the open sketch, standing square to the sketch.
    planeThroughSketchLine: {
      run: () => {
        const d = useReverse.getState().sketchDraft
        const sel = d?.selection.length === 1 ? d.sketch.entities.find((e) => e.id === d.selection[0]) : undefined
        if (!d || !sel || sel.kind !== 'line') { useStore.getState().setStatus('Select one line in an open 2D sketch first.'); return }
        const { origin: o, basisU: u, basisV: v, normal: n } = d.frame
        const at = (p: readonly number[]) => [0, 1, 2].map((i) => o[i] + u[i] * p[0] + v[i] * p[1])
        const a = at(sel.a), b = at(sel.b)
        const t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
        // Normal = line × sketch normal: square to both, so the plane holds the
        // line and stands upright on the sketch.
        const m = [t[1] * n[2] - t[2] * n[1], t[2] * n[0] - t[0] * n[2], t[0] * n[1] - t[1] * n[0]]
        const l = Math.hypot(m[0], m[1], m[2])
        if (!(l > 1e-9)) { useStore.getState().setStatus('The selected line has no length.'); return }
        useShell.getState().setWorkspace('elements')
        const st = useStore.getState()
        st.startDraft('plane')
        st.setDraftMethod('plane-coords')
        st.setDraftParams([m[0] / l, m[1] / l, m[2] / l, ...a], 'The plane through the sketch line — check it, then confirm.')
      },
      disabled: !state.sketchDraft || state.sketchDraft.selection.length !== 1,
      title: 'Plane through sketch line: select one line in the open sketch',
    },
    // Construct → Plane along path: a plane square to the one line or arc
    // selected in the open sketch, at its start.
    planeAlongPath: {
      run: () => {
        const d = useReverse.getState().sketchDraft
        const sel = d?.selection.length === 1 ? d.sketch.entities.find((e) => e.id === d.selection[0]) : undefined
        if (!d || !sel || (sel.kind !== 'line' && sel.kind !== 'arc')) { useStore.getState().setStatus('Select one line or arc in an open 2D sketch first.'); return }
        // Where the path starts on the sheet, and which way it runs there.
        const [p, t]: [[number, number], [number, number]] = sel.kind === 'line'
          ? [sel.a, [sel.b[0] - sel.a[0], sel.b[1] - sel.a[1]]]
          : [[sel.c[0] + sel.r * Math.cos(sel.start), sel.c[1] + sel.r * Math.sin(sel.start)], [-Math.sin(sel.start) * Math.sign(sel.sweep || 1), Math.cos(sel.start) * Math.sign(sel.sweep || 1)]]
        const { origin: o, basisU: u, basisV: v } = d.frame
        const at = [0, 1, 2].map((i) => o[i] + u[i] * p[0] + v[i] * p[1])
        const dir = [0, 1, 2].map((i) => u[i] * t[0] + v[i] * t[1])
        const l = Math.hypot(dir[0], dir[1], dir[2])
        if (!(l > 1e-9)) { useStore.getState().setStatus('The selected piece has no length.'); return }
        useShell.getState().setWorkspace('elements')
        const st = useStore.getState()
        st.startDraft('plane')
        st.setDraftMethod('plane-coords')
        st.setDraftParams([dir[0] / l, dir[1] / l, dir[2] / l, ...at], 'The plane square to the path at its start — check it, then confirm.')
      },
      disabled: !state.sketchDraft || state.sketchDraft.selection.length !== 1,
      title: 'Plane along path: select one line or arc in the open sketch',
    },
    rebuild: action(() => {
      useReverse.setState((s) => ({ buildVersion: s.buildVersion + 1 }))
      useStore.getState().setStatus('Rebuilding the whole history…')
    }, state.features.length > 0, 'Nothing to rebuild yet — add a feature first.'),
    envMap: {
      run: () => { useZebra.getState().toggle('envmap'); useStore.getState().setStatus(useZebra.getState().mode === 'envmap' ? 'Environment Map on — a wobble in the reflected horizon shows waviness.' : 'Environment Map off.') },
      disabled: state.bodies.length === 0,
      title: state.bodies.length === 0 ? 'Build a CAD body first — Environment Map shows its surface quality.' : 'Environment Map: the CAD bodies as polished metal',
    },
    draftAnalysis: {
      run: () => { useZebra.getState().toggle('draft'); useStore.getState().setStatus(useZebra.getState().mode === 'draft' ? 'Draft: green opens to +Z, red undercuts, yellow is within 1° of vertical.' : 'Draft analysis off.') },
      disabled: state.bodies.length === 0,
      title: state.bodies.length === 0 ? 'Build a CAD body first — Draft colours its faces by angle to Z.' : 'Draft: colour the CAD faces by their angle to the Z pull direction',
    },
    zebra: {
      run: () => { useZebra.getState().toggle('zebra'); useStore.getState().setStatus(useZebra.getState().mode === 'zebra' ? 'Zebra Stripes on — kinks in the bands show curvature jumps between faces.' : 'Zebra Stripes off.') },
      disabled: state.bodies.length === 0,
      title: state.bodies.length === 0 ? 'Build a CAD body first — Zebra Stripes shows its surface quality.' : 'Zebra Stripes: reflection bands on the CAD bodies',
    },
    sketch: action(() => {
      if (state.startSketchOn(throughPart('z'))) {
        useReverse.setState((s) => (s.sketchDraft ? { sketchDraft: { ...s.sketchDraft, placing: true } } : {}))
        useStore.getState().setStatus('Create Sketch: pick the plane, drag the yellow arrow through the part, then Create.')
      }
    }),
    freeformObj: action(chooseFreeformObj),
    wrapSurface: action(openWrapSurface, !!fileName && (reverseSession()?.sceneRef.current?.paintedVertices().length ?? 0) >= SURFACE_MIN_REGION, 'Select a region of the scan first.'),
    autoFreeform: action(() => useAutoFreeformDialog.getState().setOpen(true), !!fileName, 'Import a scan first.'),
    surface: action(() => state.startFeature('surface', { fit: { ...DEFAULT_SURFACE_FIT, smoothingLevel: 1 } }), !!fileName, 'Import a scan first.'),
    network: action(() => state.startFeature('network'), !!fileName, 'Import a scan first.'),
    extrude: action(() => state.startExtrude(), sketches > 0, 'Create a sketch first.'),
    revolve: action(() => state.startRevolve(), sketches > 0, 'Create a sketch first.'),
    fillet: action(() => state.startFeature('fillet'), state.bodies.length > 0, 'Create or import a body first.'),
    chamfer: action(() => state.startFeature('chamfer'), state.bodies.length > 0, 'Create or import a body first.'),
    moveFace: action(() => state.startFeature('moveFace'), state.bodies.length > 0, 'Create or import a body first.'),
    note: action(() => { useNotes.getState().setPinsShown(true); useNotes.getState().setPlacing(true) }, usePrefs.getState().agentLink, 'Switch the AI connection on first (AI tab).'),
    notes: action(() => { useNotes.getState().setPinsShown(true); useStore.getState().setStatus('Notes for the AI are listed in the CAD panel, under Notes; their pins are on the part.') }, usePrefs.getState().agentLink, 'Switch the AI connection on first (AI tab).'),
    trim: action(() => state.startFeature('trim'), !!fileName && (state.bodies.some((b) => b.surface) || useStore.getState().elements.some((e) => ['plane', 'cylinder', 'cone', 'sphere'].includes(e.fit?.kind ?? ''))), 'Fit surfaces or primitives first.'),
    deleteFace: action(() => state.startFeature('deleteFace'), state.bodies.length > 0, 'Create or import a body first.'),
    thread: action(() => state.startFeature('thread'), state.bodies.length > 0, 'Create or import a body first.'),
    loft: action(() => state.startFeature('loft'), sketches >= 2, 'Create at least two sketches first.'),
    sweep: action(() => state.startFeature('sweep'), sketches >= 2, 'Create at least two sketches first.'),
    pipe: action(() => usePipeDialog.getState().setOpen(true), sketches > 0, 'Draw the path in a 2D sketch first.'),
    sheet: action(() => state.startFeature('sheet'), sketches > 0, 'Create a sketch first.'),
    thicken: action(() => state.startFeature('thicken'), state.bodies.some(b => b.surface), 'Create a surface body first.'),
    boolean: action(() => state.startFeature('boolean'), state.bodies.length >= 2, 'Create or import at least two bodies first.'),
    // Combine, Cut and Intersect are three keys in QUICKSURFACE: the same
    // editor, opened on that operation (audit 2026-11-07, W-02).
    booleanJoin: action(() => state.startFeature('boolean', { op: 'join' }), state.bodies.length >= 2, 'Create or import at least two bodies first.'),
    booleanCut: action(() => state.startFeature('boolean', { op: 'cut' }), state.bodies.length >= 2, 'Create or import at least two bodies first.'),
    booleanIntersect: action(() => state.startFeature('boolean', { op: 'intersect' }), state.bodies.length >= 2, 'Create or import at least two bodies first.'),
    pattern: action(() => state.startFeature('pattern'), state.bodies.length > 0, 'Create or import a body first.'),
    patternCircular: action(() => state.startFeature('pattern', { mode: 'circular' }), state.bodies.length > 0, 'Create or import a body first.'),
    patternLinear: action(() => state.startFeature('pattern', { mode: 'linear' }), state.bodies.length > 0, 'Create or import a body first.'),
    mirror: action(() => state.startFeature('mirror'), state.bodies.length > 0, 'Create or import a body first.'),
    shell: action(() => state.startFeature('shell'), state.bodies.length > 0, 'Create or import a body first.'),
    draft: action(() => state.startFeature('draft'), state.bodies.length > 0, 'Create or import a body first.'),
    moveBody: action(() => state.startFeature('moveBody', { bodies: state.bodies.filter((b) => b.visible).map((b) => b.id) }), state.bodies.length > 0, 'Create or import a body first.'),
    scaleBody: action(() => { state.startFeature('moveBody', { bodies: state.bodies.filter((b) => b.visible).map((b) => b.id) }); useReverse.setState((s) => (s.featureDraft?.kind === 'moveBody' ? { featureDraft: { ...s.featureDraft, scale: 1 } } : {})); useStore.getState().setStatus('Scale body: type the factor in Scale — 2 doubles every size, 0.5 halves it — then Create.') }, state.bodies.length > 0, 'Create or import a body first.'),
    split: action(() => state.startFeature('split'), state.bodies.length > 0, 'Create or import a body first.'),
    offsetBody: action(() => state.startFeature('offsetBody'), state.bodies.length > 0, 'Create or import a body first.'),
    export: action(onExport, state.bodies.some((b) => b.visible && (b.closed || b.surface)), 'Create a visible solid or surface first.'),
  }
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return <div className="desktop-ribbon-group"><div className="desktop-ribbon-tools">{children}</div><div className="desktop-ribbon-label">{label}</div></div>
}

/** The same entry points as ReversePanel, with explicit prerequisite messages. */
export function ReverseRibbon() {
  const state = useReverse()
  const busy = useStore((s) => s.busy)
  const fileName = useStore((s) => s.fileName)
  const picking = useDeviation((s) => s.picking)
  const editor = reEditorOpen(state)
  const blocked = busy || state.building || state.playback !== null || picking || editor || state.kernelStatus !== 'ready'
  const blockedReason = editor ? 'Finish or cancel the current feature first.' : state.kernelStatus !== 'ready' ? 'Wait for the CAD kernel to be ready.' : 'Wait for the current operation to finish.'
  const sketches = state.features.filter((f) => f.kind === 'sketch').length
  const hasBody = state.bodies.length > 0
  function tool(id: string, label: string, icon: IconName, action: () => void, requirement = true, reason = '', description = label) {
    const disabled = blocked || !requirement
    return <button key={id} type="button" className="desktop-ribbon-tool" data-test={`ribbon-cad-${id}`} disabled={disabled}
      title={disabled ? (blocked ? blockedReason : reason) : description} onClick={action}>
      <Icon name={icon} size={26} /><span>{label}</span>
    </button>
  }
  const startSketch = () => {
    if (useReverse.getState().startSketchOn(throughPart('z'))) {
      useReverse.setState((s) => (s.sketchDraft ? { sketchDraft: { ...s.sketchDraft, placing: true } } : {}))
      useStore.getState().setStatus('Create Sketch: pick the plane, drag the yellow arrow through the part, then Create.')
    } else useStore.getState().setError('The XY sketch plane is not available.')
  }
  return <>
    <Group label="Sketch & solids">
      {tool('sketch', 'XY sketch', 'sketch', startSketch, true, '', 'Start a 2D sketch on the XY coordinate plane. Other planes are available in the tool panel.')}
      {tool('extrude', 'Extrude', 'extrude', () => state.startExtrude(), sketches > 0, 'Create a sketch first.', 'Pick sketch regions and extrude into a solid.')}
      {tool('revolve', 'Revolve', 'revolve', () => state.startRevolve(), sketches > 0, 'Create a sketch first.', 'Revolve sketch regions about an axis.')}
    </Group>
    <Group label="Surface reconstruction">
      {tool('surface', 'Fit surface', 'surface', () => state.startFeature('surface', { fit: { ...DEFAULT_SURFACE_FIT, smoothingLevel: 1 } }), !!fileName, 'Import a scan first.', 'Fit a smooth surface to a selected or marked scan region.')}
      {tool('network', 'Patch network', 'spline', () => state.startFeature('network'), !!fileName, 'Import a scan first.', 'Draw curves on the scan and fit connected surface patches.')}
      {tool('loft', 'Loft', 'loft', () => state.startFeature('loft'), sketches >= 2, 'Create at least two sketches first.')}
      {tool('sheet', 'Sheet', 'sheet', () => state.startFeature('sheet'), sketches > 0, 'Create a sketch first.')}
    </Group>
    <Group label="Modify bodies">
      {tool('fillet', 'Fillet', 'fillet', () => state.startFeature('fillet'), hasBody, 'Create or import a body first.')}
      {tool('chamfer', 'Chamfer', 'chamfer', () => state.startFeature('chamfer'), hasBody, 'Create or import a body first.')}
      {tool('move-face', 'Move face', 'moveFace', () => state.startFeature('moveFace'), hasBody, 'Create or import a body first.')}
      {tool('combine', 'Combine', 'combine', () => state.startFeature('boolean'), state.bodies.length >= 2, 'Create or import at least two bodies first.')}
      {tool('trim', 'Trim', 'trim', () => state.startFeature('trim'), !!fileName, 'Import a scan and fit surfaces or primitives first.', 'Trim fitted surfaces and primitives against each other into a solid.')}
      {tool('delete-faces', 'Delete Faces', 'erase', () => state.startFeature('deleteFace'), hasBody, 'Create or import a body first.', 'Click faces of a body to delete them; the faces around heal over.')}
      {tool('helix', 'Helix / Thread', 'spline', () => state.startFeature('thread'), hasBody, 'Create or import a body first.', 'A modelled screw thread on a round face.')}
      {tool('pattern', 'Pattern', 'pattern', () => state.startFeature('pattern'), hasBody, 'Create or import a body first.')}
    </Group>
  </>
}
