// SPDX-License-Identifier: AGPL-3.0-only
// The CAD workspace exposes its own actions; the shell knows no plugin state.
import type { ReactNode } from 'react'
import { Icon, type IconName } from '../../../src/ui/icons'
import { useStore } from '../../../src/state/store'
import { useDeviation } from '../../../src/state/deviationStore'
import { reEditorOpen, useReverse } from '../state/reStore'
import type { PluginRuntime } from '../../../src/plugins/api'
import { bodyMaker } from '../core/features'
import { useNotes } from '../state/noteStore'
import { usePrefs } from '../../../src/state/prefsStore'
import { throughPart } from './PlaceSketch'

/** Shared workflow buttons still call plugin-owned verbs and prerequisites. */
export function useReverseRibbonActions(onExport: () => void): NonNullable<PluginRuntime['ribbonActions']> {
  const state = useReverse()
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
    sketch: action(() => {
      if (state.startSketchOn(throughPart('z'))) {
        useReverse.setState((s) => (s.sketchDraft ? { sketchDraft: { ...s.sketchDraft, placing: true } } : {}))
        useStore.getState().setStatus('Create Sketch: pick the plane, drag the yellow arrow through the part, then Create.')
      }
    }),
    surface: action(() => state.startFeature('surface'), !!fileName, 'Import a scan first.'),
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
    sheet: action(() => state.startFeature('sheet'), sketches > 0, 'Create a sketch first.'),
    thicken: action(() => state.startFeature('thicken'), state.bodies.some(b => b.surface), 'Create a surface body first.'),
    boolean: action(() => state.startFeature('boolean'), state.bodies.length >= 2, 'Create or import at least two bodies first.'),
    pattern: action(() => state.startFeature('pattern'), state.bodies.length > 0, 'Create or import a body first.'),
    mirror: action(() => state.startFeature('mirror'), state.bodies.length > 0, 'Create or import a body first.'),
    shell: action(() => state.startFeature('shell'), state.bodies.length > 0, 'Create or import a body first.'),
    draft: action(() => state.startFeature('draft'), state.bodies.length > 0, 'Create or import a body first.'),
    moveBody: action(() => state.startFeature('moveBody', { bodies: state.bodies.filter((b) => b.visible).map((b) => b.id) }), state.bodies.length > 0, 'Create or import a body first.'),
    split: action(() => state.startFeature('split'), state.bodies.length > 0, 'Create or import a body first.'),
    offsetBody: action(() => state.startFeature('offsetBody'), state.bodies.length > 0, 'Create or import a body first.'),
    export: action(onExport, state.bodies.some((b) => b.visible && (b.closed || (b.surface && state.features.some((f) => f.kind === 'network' && f.id === bodyMaker(b.id))))), 'Create a closed solid or a patch network first.'),
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
      {tool('surface', 'Fit surface', 'surface', () => state.startFeature('surface'), !!fileName, 'Import a scan first.', 'Fit a smooth surface to a selected or marked scan region.')}
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
