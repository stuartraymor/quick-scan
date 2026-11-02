// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState, type ReactNode } from 'react'
import { useStore } from '../state/store'
import { useDocumentOrder } from '../state/documentOrderStore'
import { useShell } from '../state/shellStore'
import { usePrefs } from '../state/prefsStore'
import { useDeviation } from '../state/deviationStore'
import { useMark } from '../state/markStore'
import {useInteractiveAlign} from '../state/interactiveAlignStore'
import { plugins } from '../plugins/registry'
import type { ElementKind } from '../core/types'
import type { PluginRuntime } from '../plugins/api'
import { CREATION_METHODS } from '../core/elements/construct'
import { Icon, type IconName } from './icons'
import { AiWizard } from './AiWizard'
import { useAgentConnectionHint } from '../commands/agentSetup'
import { useUpdater } from './UpdateButton'
import { REFERENCE_EXAMPLES } from '../app/referenceExamples'
import { APP_VERSION } from '../version'
import { AGENT_STATUS, useAgentLink } from '../commands/agentLink'
import { UndoRedo } from './UndoRedo'
import { HelpDialog, type HelpDialogId } from './HelpDialogs'
import type { StandardView } from '../viewer/orthoViewport'

type Props = {
  onFit: (kind: ElementKind) => void
  onSection: () => void
  onAlign: () => void
  onAutoAlign: () => void
  onFineAlign: () => void
  onPointAlign: () => void
  onExport: () => void
  onExample?: (id: string) => void
  exampleBusy?: boolean
  onOpen: () => void
  onSave: () => void
  onDeselect: () => void
  onSnapshot: () => void
  onHideSelected: () => void
  onIsolate: () => void
  onShowHidden: () => void
  onView?: (view: StandardView) => void
  onFitView?: () => void
  savable: boolean
  pluginTools?: ReactNode
  cadActions?: PluginRuntime['ribbonActions']
}
function Group({ label, children }: { label: string; children: ReactNode }) {
  return <div className="desktop-ribbon-group"><div className="desktop-ribbon-tools">{children}</div><span className="desktop-ribbon-label">{label}</span></div>
}

/** Familiar command positions, backed by the existing session and plugin verbs. */
export function DesktopRibbon({ onFit, onSection, onAlign, onFineAlign, onPointAlign, onExport, onOpen, onExample, exampleBusy = false, onSave, onDeselect, onSnapshot, onHideSelected, onIsolate, onShowHidden, onView, onFitView, savable, cadActions }: Props) {
  const file = useStore(s => s.fileName)
  const busy = useStore(s => s.busy)
  const interactive = useInteractiveAlign(s => s.open)
  const drafting = useStore(s => Boolean(s.draft || s.sectionDraft || s.alignDraft || s.dimDraft)) || interactive
  const tab = useShell(s => s.ribbonTab)
  const picking = useDeviation(s => s.picking)
  const hasReference = useDeviation(s => Boolean(s.nominalName))
  const wireframe = useStore(s => s.wireframe)
  const translucent = useStore(s => s.translucent)
  const [pending, setPending] = useState<string | null>(null)
  const [aiWizard, setAiWizard] = useState(false)
  const [about, setAbout] = useState(false)
  const [helpDialog, setHelpDialog] = useState<HelpDialogId | null>(null)
  const updater = useUpdater()
  const hiddenTriangles = useShell(s => s.hiddenTriangles)
  const marked = useMark(s => s.count)
  const agentLink = usePrefs(s => s.agentLink)
  const units = usePrefs(s => s.units)
  const agent = useAgentLink()
  const agentHint = useAgentConnectionHint()
  const modelRolled = useDocumentOrder(s => s.rollbackAt !== null)
  const rolledTools = modelRolled && !['view', 'help', 'settings', 'ai'].includes(tab)
  const locked = busy || picking || drafting || modelRolled
  const needsScan = locked || !file
  const go = (id: string) => useShell.getState().setWorkspace(id)
  const mesh = plugins().find(p => p.id === 'mesh-tools')?.workspace
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.altKey) return
      const target = event.target as HTMLElement | null
      const editingText = Boolean(target?.closest('input,textarea,select,[contenteditable="true"]'))
      const key = event.key.toLowerCase()
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey) {
        if (key === 's') { event.preventDefault(); if (!busy && savable) onSave() }
        if (key === 'o') { event.preventDefault(); if (!busy && !picking) onOpen() }
        return
      }
      if (editingText || event.ctrlKey || event.metaKey || event.shiftKey || needsScan || useShell.getState().workspace !== 'elements') return
      const kind = ({ p: 'plane', c: 'cylinder', o: 'cone', e: 'sphere' } as Record<string, ElementKind>)[key]
      if (kind) { event.preventDefault(); onFit(kind) }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [busy, picking, savable, needsScan, onFit, onSave, onOpen])
  // `small` is QUICKSURFACE's compact key: just the icon, three to a column. The
  // label stays in the DOM for assistive technology and for the title tooltip.
  const tool = (label: string, icon: IconName, action: () => void, disabled = false, hint = label, small = false) => (
    <button className={small ? 'desktop-ribbon-tool ribbon-stack-tool' : 'desktop-ribbon-tool'} key={label} disabled={disabled} aria-label={small ? label : undefined} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); useShell.getState().setInspectorOpen(true); useStore.getState().setStatus(''); action() }}
      title={hint} data-test={`ribbon-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
      <Icon name={icon} size={small ? 18 : 25} /><span>{label}</span>
    </button>
  )
  // QUICKSURFACE's text-only keys (Help tab, System and About groups).
  const textKey = (label: string, action: () => void, hint = label) => (
    <button className="ribbon-text-key" key={label} title={hint} data-test={`ribbon-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} onClick={action}>{label}</button>
  )
  // Ribbon menus behave like desktop menus: one open at a time, dismissed by an
  // outside click or Escape (Escape is consumed so it does not also cancel an
  // operation), and kept inside the window.
  useEffect(() => {
    const open = () => Array.from(document.querySelectorAll<HTMLDetailsElement>('.desktop-ribbon details.ribbon-dropdown[open]'))
    const place = (menu: HTMLDetailsElement) => {
      const panel = menu.querySelector<HTMLElement>('.ribbon-menu')
      if (!panel) return
      const anchor = menu.getBoundingClientRect()
      panel.style.left = '0px'; panel.style.top = '0px'
      const size = panel.getBoundingClientRect()
      const left = Math.max(4, Math.min(anchor.left, window.innerWidth - size.width - 4))
      const top = Math.max(4, Math.min(anchor.bottom, window.innerHeight - size.height - 4))
      panel.style.left = `${left}px`; panel.style.top = `${top}px`
    }
    const toggle = (event: Event) => {
      const menu = event.target as HTMLDetailsElement
      if (!menu.matches?.('details.ribbon-dropdown') || !menu.open) return
      open().forEach(other => { if (other !== menu) other.removeAttribute('open') })
      place(menu)
    }
    const pointer = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      open().forEach(menu => { if (!menu.contains(target)) menu.removeAttribute('open') })
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const menus = open()
      if (!menus.length) return
      event.preventDefault(); event.stopPropagation()
      menus.forEach(menu => { menu.removeAttribute('open'); menu.querySelector<HTMLElement>('summary')?.focus() })
    }
    const resize = () => open().forEach(place)
    document.addEventListener('toggle', toggle, true)
    document.addEventListener('pointerdown', pointer, true)
    window.addEventListener('keydown', escape, true)
    window.addEventListener('resize', resize)
    document.addEventListener('scroll', resize, true)
    return () => {
      document.removeEventListener('toggle', toggle, true)
      document.removeEventListener('pointerdown', pointer, true)
      window.removeEventListener('keydown', escape, true)
      window.removeEventListener('resize', resize)
      document.removeEventListener('scroll', resize, true)
    }
  }, [])
  // A scan-to-CAD command can start the kernel on first use, then opens the
  // requested editor. The operator does not have to find the command again.
  useEffect(() => {
    if (!pending) return
    if (useDocumentOrder.getState().rollbackAt !== null) { setPending(null); return }
    const action = cadActions?.[pending]
    if (!action) { setPending(null); return }
    if (action.title?.includes('CAD kernel') || action.title === 'Finish the current operation first.') return
    if (action.disabled) useStore.getState().setStatus(action.title || 'Finish the current operation first.')
    else action.run()
    setPending(null)
  }, [pending, cadActions, modelRolled])
  useEffect(() => {
    if (!pending) return
    const timer = setTimeout(() => { setPending(null); useStore.getState().setStatus('CAD initialization is taking longer than expected. Check the CAD tool panel.'); }, 30000)
    return () => clearTimeout(timer)
  }, [pending])
  const cad = (id: string, label: string, icon: IconName, scanRequired = false, small = false) => {
    const action = cadActions?.[id]
    const loading = action?.title?.includes('CAD kernel')
    const disabled = locked || !!pending || !action || (scanRequired && !file) || (action.disabled && !loading)
    return tool(label, icon, () => {
      go('reverse')
      if (loading) { setPending(id); useStore.getState().setStatus(`Preparing CAD tools for ${label}…`) }
      else action?.run()
    }, disabled, action?.title || `${label} — open its contextual editor`, small)
  }
  // A plain button, as in QUICKSURFACE: it opens the Extract primitives dialog
  // (select the area, then click the primitive type).
  const primitives = tool('Extract primitives', 'extract', () => { go('elements'); useShell.getState().setExtractOpen(true) }, needsScan, 'Select an area of the scan, then click the primitive type to fit')
  const used = new Set<string>()
  const method = (id: string) => {
    const m = CREATION_METHODS.find((x) => x.id === id)
    if (!m) return null
    used.add(id)
    return () => { go('elements'); onFit(m.kind); useStore.getState().setDraftMethod(m.id) }
  }
  const fitKind = (kind: ElementKind) => () => { go('elements'); onFit(kind) }
  const constructItem = (label: string, run: (() => void) | null, title = label) => (
    <button key={label} disabled={needsScan || !run} title={run ? title : 'Not available in Quick Scan yet'} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); run?.() }}>{label}</button>
  )
  const constructEntries = [
    constructItem('Plane ...', method('plane-coords'), 'Type in a plane'),
    constructItem('Middle plane ...', method('plane-midplane'), 'A plane midway between two'),
    constructItem('Plane from current view', null),
    constructItem('Plane along path ...', null),
    constructItem('Plane through sketch line ...', null),
    constructItem('Plane from 2D sketch', null),
    constructItem('Plane from selected CAD face', null),
    constructItem('Symmetry Plane ...', method('plane-symmetry'), 'The plane a part mirrors across'),
    <hr key="h1" />,
    constructItem('Cylinder ...', fitKind('cylinder'), 'Opens the cylinder editor (fit to the scan); typed-in construction is not built yet'),
    constructItem('Cylinder from selected CAD face', null),
    <hr key="h2" />,
    constructItem('Cone ...', fitKind('cone'), 'Opens the cone editor (fit to the scan); typed-in construction is not built yet'),
    constructItem('Cone from selected CAD face', null),
    <hr key="h3" />,
    constructItem('Sphere ...', fitKind('sphere'), 'Opens the sphere editor (fit to the scan); typed-in construction is not built yet'),
    <hr key="h4" />,
    constructItem('Reference Line ...', method('line-two-points'), 'A reference line through two points'),
    constructItem('Reference Point ...', method('point-coords'), 'A reference point at typed coordinates'),
  ]
  // The construction methods QUICKSURFACE's list has no entry for stay reachable, below a divider.
  const moreMethods = CREATION_METHODS.filter((m) => m.mode === 'construct' && ['plane-three-points', 'plane-offset', 'point-centroid', 'point-midpoint', 'point-line-plane', 'line-axis', 'line-plane-plane'].includes(m.id) && !used.has(m.id))
  const construct = <details className="ribbon-dropdown"><summary className="desktop-ribbon-tool" title="Construct reference geometry"><Icon name="construction" size={25}/><span>Construct ▾</span></summary><div className="ribbon-menu">
    {constructEntries}
    <hr />
    {moreMethods.map((m) => constructItem(m.label, method(m.id), m.hint))}
  </div></details>
  const alignMenu = <details className="ribbon-dropdown" data-test="align-menu"><summary className="desktop-ribbon-tool" title="Choose an alignment method"><Icon name="alignSheet" size={25}/><span>Align ▾</span></summary><div className="ribbon-menu">
    {tool('Align by Coordinate System …', 'alignSheet', () => { go('elements'); onAlign() }, needsScan, 'Pick primary, secondary and tertiary features, preview, then Apply')}
    {tool('Align Interactive…', 'navigate', () => { go('elements'); useShell.getState().setExtractOpen(false); useMark.getState().setGesture(null); useInteractiveAlign.getState().start(useStore.getState().modelCenter) }, needsScan, 'Drag a colored axis arrow or rotation arc to position the scan; OK applies and Cancel restores the original pose')}
    {tool('By N points …', 'pickPoints', () => { go('deviation'); onPointAlign() }, needsScan || !hasReference, 'Requires a loaded scan and reference model; pick corresponding points')}
    {tool('Fine-align reference mesh …', 'compare', () => { go('deviation'); onFineAlign() }, needsScan || !hasReference, 'Requires a loaded scan and reference model; run the existing best fit')}
  </div></details>
  const surfacingMenu = <details className="ribbon-dropdown"><summary className="desktop-ribbon-tool" title="Surface creation and editing"><Icon name="loft" size={25}/><span>Surfacing ▾</span></summary><div className="ribbon-menu">
    {cad('surface','Fit Surface','surface',true)}{cad('sheet','Extruded surface','sheet')}{cad('loft','Loft','loft')}{cad('sweep','Sweep','spline')}{cad('network','Patch network','surface',true)}{cad('thicken','Thicken surface','shell')}{cad('thread','Helix','spline')}
  </div></details>
  const patternMenu = <details className="ribbon-dropdown"><summary className="desktop-ribbon-tool" title="Patterns and mirror"><Icon name="pattern" size={25}/><span>Pattern ▾</span></summary><div className="ribbon-menu">{cad('pattern','Linear / circular pattern','pattern')}{cad('mirror','Mirror','mirror')}</div></details>
  const examplesMenu = <details className="ribbon-dropdown" data-test="examples-menu">
    <summary className="desktop-ribbon-tool" title="Open an example model" aria-label="Examples" aria-disabled={busy || picking || exampleBusy}
      onClick={e => { if (busy || picking || exampleBusy) e.preventDefault() }}><Icon name="load" size={25}/><span>Examples ▾</span></summary>
    <div className="ribbon-menu" role="menu" aria-label="Examples">
      {REFERENCE_EXAMPLES.map(item => <button key={item.id} role="menuitem" data-test={`example-${item.id}`} disabled={!onExample || busy || picking || exampleBusy}
        onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); onExample?.(item.id) }}>{item.label}</button>)}
    </div>
  </details>
  const fileGroup = <Group label="File">{tool('Open', 'load', onOpen, busy || picking, 'Open a scan or project')}{tool('Save', 'save', onSave, busy || !savable, 'Save the entire Quick Scan project')}</Group>
  const analysis = <Group label="Analysis">{tool('Compare', 'compare', () => go('deviation'), locked, 'Compare scan data with CAD or fitted geometry')}</Group>
  const exportGroup = <Group label="Export Model">{cadActions ? cad('export', 'Export', 'exportStep') : tool('Export', 'exportStep', onExport, needsScan)}</Group>
  const scanGroup = <Group label="Scan Data">{tool('Prepare Scan', 'reduceMesh', () => { useShell.getState().setPrepareStep(0); if (mesh) go(mesh.id) }, needsScan, 'Prepare Scan: a four-step guide — mesh quality, symmetry, alignment primitives, alignment')}{tool('Edit Scan', 'wsMesh', () => mesh && go(mesh.id), needsScan || !mesh, 'Open mesh selection, repair and editing')}{tool('Deselect All', 'select', onDeselect, needsScan || marked === 0, 'Clear the painted scan selection')}</Group>
  const main = <>
    {fileGroup}{scanGroup}
    <Group label="Primitives">{primitives}{construct}</Group>
    <Group label="Align">{alignMenu}</Group>
    <Group label="Cross sections">{cad('sketch', '2D Sketch', 'sketch')}{tool('Multiple sections', 'section', () => { go('elements'); onSection() }, needsScan, 'Create planar cross sections; stacked sections are not yet implemented')}</Group>
    <Group label="Surfacing">{cad('surface', 'Fit Surface', 'surface', true)}{surfacingMenu}</Group>
    <Group label="Freeform">{tool('New Freeform', 'surface', () => {}, true, 'Quad-based freeform surfacing is not implemented in Quick Scan yet')}{tool('Auto Freeform', 'scan', () => {}, true, 'Automatic freeform surfacing is not implemented in Quick Scan yet')}</Group>
    <Group label="Part Design"><div className="ribbon-stack">{cad('extrude', 'Extrude', 'extrude', false, true)}{cad('revolve', 'Revolve', 'revolve', false, true)}{cad('moveFace', 'Move face', 'moveFace', false, true)}</div>{cad('trim', 'Trim', 'trim', true)}{patternMenu}{cad('fillet', 'Fillet / Chamfer', 'fillet')}</Group>
    {analysis}{exportGroup}
  </>
  // A command QUICKSURFACE has in this place that Quick Scan has not built yet:
  // shown greyed in its position so the layout matches.
  // QUICKSURFACE's small key with a visible label: a 16 px icon and the name,
  // three to a column (Scan Data's Tools, Align and Colors groups).
  const smallText = (label: string, icon: IconName, action: () => void, disabled = false, hint = label) => (
    <button className="ribbon-text-key with-icon" key={label} disabled={disabled} title={hint} data-test={`ribbon-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} onClick={action}>
      <Icon name={icon} size={16} /><span>{label}</span>
    </button>
  )
  const smallSoon = (label: string, icon: IconName) => smallText(label, icon, () => {}, true, `${label} is not built in Quick Scan yet`)
  const meshAction = (id: string) => cadActions?.[id]
  const meshTool = (id: string, label: string, icon: IconName, hint: string, small = false) => {
    const a = meshAction(id)
    const run = () => a?.run()
    const off = needsScan || !a || a.disabled
    return small ? smallText(label, icon, run, off, a?.title ?? hint) : tool(label, icon, run, off, a?.title ?? hint)
  }
  const soon = (label: string, icon: IconName) => tool(label, icon, () => {}, true, `${label} is not built in Quick Scan yet`)
  // The Scan Data tab as QUICKSURFACE lays it out: Edit Scan data, Tools, Align,
  // Colors, Export Visible. Hide Selected and Isolate are Quick Scan's own extra
  // keys and keep a group of their own at the end.
  const scanDataTab = <>
    <Group label="Edit Scan data">
      {tool('Edit', 'wsMesh', () => mesh && go(mesh.id), needsScan || !mesh, 'Open mesh selection, repair and editing')}
      <div className="ribbon-text-stack">
        {smallText('Deselect All', 'select', onDeselect, needsScan || marked === 0, 'Clear the painted scan selection')}
        {smallText('Show Hidden', 'eye', onShowHidden, hiddenTriangles === 0, 'Show all hidden triangles')}
        {smallSoon('Invert Hidden', 'markInvert')}
      </div>
    </Group>
    <Group label="Tools">
      {meshTool('meshReduce', 'Reduce polygons', 'reduceMesh', 'Make a lighter mesh within a tolerance of the scan')}
      {meshTool('meshSmooth', 'Reduce noise', 'smoothMesh', 'Smooth the scatter on the scan')}
      <div className="ribbon-text-grid">
        {smallSoon('Scale', 'dimLength')}
        {meshTool('meshFlip', 'Flip Normals', 'flip', 'Turn a surface that faces the wrong way', true)}
        {smallSoon('Re-polygonize', 'mesh')}
        {smallSoon('Average Mesh', 'mesh')}
        {smallSoon('Mirror', 'mirror')}
        {smallSoon('Unroll', 'sheet')}
      </div>
    </Group>
    <Group label="Align">
      {tool('Align by Coordinate System', 'alignSheet', () => { go('elements'); onAlign() }, needsScan, 'Pick primary, secondary and tertiary features, preview, then Apply')}
      {tool('Align Interactive', 'navigate', () => { go('elements'); useShell.getState().setExtractOpen(false); useMark.getState().setGesture(null); useInteractiveAlign.getState().start(useStore.getState().modelCenter) }, needsScan, 'Drag a colored axis arrow or rotation arc to position the scan; OK applies and Cancel restores the original pose')}
      <div className="ribbon-text-stack">
        {smallText('By N points', 'pickPoints', () => { go('deviation'); onPointAlign() }, needsScan || !hasReference, 'Requires a loaded scan and reference model; pick corresponding points')}
        {smallText('Fine-align', 'compare', () => { go('deviation'); onFineAlign() }, needsScan || !hasReference, 'Requires a loaded scan and reference model; run the existing best fit')}
        {smallSoon('Global Fine Align', 'compare')}
      </div>
    </Group>
    <Group label="Colors"><div className="ribbon-text-stack">{smallSoon('Auto colorize', 'scanColours')}{smallSoon('Set Default Color', 'colourPlot')}</div></Group>
    <Group label="Export Visible">{tool('Export', 'exportStep', onExport, needsScan, 'Export the visible scan data')}</Group>
    <Group label="Visibility">{tool('Hide Selected', 'eyeOff', onHideSelected, needsScan || marked === 0, 'Hide the selected triangles')}{tool('Isolate', 'model', onIsolate, needsScan || marked === 0, 'Leave the selected triangles and hide the rest')}</Group>
  </>
  const freeformTab = <>{fileGroup}
    <Group label="Create New Freeform">{tool('New Freeform', 'surface', () => {}, true, 'Quad-based freeform surfacing is not implemented in Quick Scan yet')}{tool('Auto Freeform', 'scan', () => {}, true, 'Automatic freeform surfacing is not implemented in Quick Scan yet')}{soon('Wrap Surface', 'elCylinder')}{soon('From 3D Sketch', 'sketch')}{soon('From quad OBJ', 'load')}</Group>
    <Group label="Tools">{cad('thicken', 'Thicken', 'shell')}{cad('offsetBody', 'Offset', 'sheet')}{soon('Convert to CAD body', 'exportStep')}</Group>
    {exportGroup}</>
  const surfacingTab = <>{fileGroup}
    <Group label="Create">{cad('surface', 'Fit Surface', 'surface', true)}{cad('loft', 'Loft', 'loft')}{soon('Fill Surface', 'fillHoles')}{cad('sheet', 'From 2D sketch', 'sheet')}{cad('sweep', 'Sweep', 'spline')}{soon('Pipe', 'elCylinder')}{cad('network', '3D Sketch', 'sketch', true)}{cad('thread', 'Helix', 'rotateCw')}{soon('Roll Sketch', 'revolve')}</Group>
    <Group label="Tools">{soon('Duplicate Face', 'deleteSurface')}{cad('offsetBody', 'Offset', 'sheet')}{cad('thicken', 'Thicken', 'shell')}{soon('Extend Surface', 'extrude')}{soon('Sew surfaces', 'opJoin')}{soon('Flatten', 'sheet')}{soon('Project sketch', 'project')}</Group>
    {exportGroup}</>
  const cadTab = <>{fileGroup}
    <Group label="Cross sections">{cad('sketch', '2D Sketch', 'sketch')}{tool('Multiple sections', 'section', () => { go('elements'); onSection() }, needsScan, 'Create planar cross sections; stacked sections are not yet implemented')}</Group>
    <Group label="Create">{cad('extrude', 'Extrude', 'extrude')}{cad('revolve', 'Revolve', 'revolve')}{cad('trim', 'Trim', 'trim', true)}{cad('boolean', 'Combine', 'opJoin')}{cad('boolean', 'Cut', 'opCut')}{cad('boolean', 'Intersect', 'opIntersect')}{cad('shell', 'Shell', 'shell')}{cad('draft', 'Draft', 'draft')}{cad('deleteFace', 'Delete faces', 'deleteSurface')}{cad('moveBody', 'Move body', 'navigate')}{cad('moveFace', 'Move face', 'moveFace')}{soon('Scale body', 'dimLength')}{cad('split', 'Split solid', 'split')}{soon('Separate bodies', 'islands')}</Group>
    <Group label="Edges">{cad('fillet', 'Fillet / Chamfer', 'fillet')}</Group>
    <Group label="Patterns">{cad('pattern', 'Circular pattern', 'rotateCcw')}{cad('pattern', 'Linear pattern', 'pattern')}{cad('mirror', 'Mirror', 'mirror')}</Group>
    {exportGroup}</>
  const settingsTab = <>{fileGroup}
    <Group label="Display Units">{tool('Millimetres', 'dimLength', () => usePrefs.getState().setUnits('mm'), units === 'mm', 'Show and type lengths in millimetres')}{tool('Inches', 'dimLength', () => usePrefs.getState().setUnits('in'), units === 'in', 'Show and type lengths in inches')}</Group>
    <Group label="Software Options">{tool('Options', 'settings', () => usePrefs.getState().openSettings(true), false, 'Navigation, display, files and agent options')}{tool('Mouse controls', 'navigate', () => usePrefs.getState().openSettings(true), false, 'Navigation scheme and display options')}</Group></>
  const analysisTab = <>
    <Group label="Tools">
      {tool('Measure', 'wsMeasure', () => go('elements'), locked, 'Measure distances between fitted elements in 3D Measure')}
      <div className="ribbon-text-stack">{smallSoon('Surface Area', 'surface')}{smallSoon('Volume', 'model')}</div>
      <div className="ribbon-text-stack">{smallSoon('Zebra Stripes', 'curvature')}{smallSoon('Environment Map', 'scanColours')}{smallSoon('Draft', 'draft')}</div>
      {tool('Snapshot', 'splitView', onSnapshot, !file, 'Snapshot to clipboard — copy the view as a picture')}
    </Group>
    <Group label="Control">{tool('Compare', 'compare', () => go('deviation'), locked, 'Compare scan data with CAD or fitted geometry')}{tool('Compare to other meshes', 'compare', () => go('deviation'), locked, 'Compare the scan with a second mesh in Surface Deviation')}</Group>
    <Group label="Inspection">{tool('Wall thickness', 'wsThickness', () => go('thickness'), locked, 'Map the wall thickness of the part itself — no reference needed')}{tool('2D Measure', 'wsFlat', () => go('flat'), locked, 'Measure a flatbed scan the way a measuring microscope would')}</Group></>
  return <div className="desktop-ribbon" aria-label="Workspace tools" inert={rolledTools || undefined} aria-disabled={rolledTools || undefined} title={rolledTools ? 'Restore End of Model in History before creating or editing geometry.' : undefined} style={rolledTools ? { opacity: .55 } : undefined}>
    {tab === 'main' ? main : tab === 'view' ? <>
      <Group label="Edit"><div className="ribbon-text-stack"><UndoRedo ribbon text />{smallSoon('Rebuild', 'rotateCw')}</div></Group>
      <Group label="View">
        {tool('Zoom To Fit', 'fitAll', () => onFitView?.(), !onFitView)}
        {tool('Isometric', 'model', () => onView?.('iso'), !onView)}
        {/* The six standard views as small text keys, three to a column, as QUICKSURFACE lays them out. */}
        <div className="ribbon-text-grid" role="group" aria-label="Standard views">
          {([
            ['top', 'Top'], ['left', 'Left'], ['front', 'Front'], ['bottom', 'Bottom'], ['right', 'Right'], ['rear', 'Back'],
          ] as [StandardView, string][]).map(([view, label]) => (
            <button key={view} className="ribbon-text-key" data-test={`ribbon-${label.toLowerCase()}`} disabled={!onView} title={`${label} view`} onClick={() => onView?.(view)}>{label}</button>
          ))}
        </div>
        {soon('Coordinate System', 'elPoint')}
      </Group>
      <Group label="Background style"><div className="ribbon-text-stack">{smallSoon('Linear', 'mesh')}{smallSoon('Studio', 'mesh')}</div></Group>
      <Group label="Display">{tool(wireframe ? 'Solid view' : 'Wireframe', 'mesh', () => useStore.getState().setWireframe(!wireframe), !file)}{tool(translucent ? 'Opaque' : 'Transparent', 'transparent', () => useStore.getState().setTranslucent(!translucent), !file)}{tool('Show scan', 'eye', () => useStore.getState().setScanHidden(false), !file)}{tool('Hide scan', 'eyeOff', () => useStore.getState().setScanHidden(true), !file)}</Group>
    </> : tab === 'scan' ? scanDataTab
      : tab === 'construct' ? <>
        <Group label="From scan data">{primitives}</Group>
        <Group label="Primitives">
          {tool('Plane', 'elPlane', method('plane-coords') ?? (() => {}), needsScan, 'Type in a plane')}
          <div className="ribbon-text-stack">
            {smallText('Middle plane', 'elPlane', method('plane-midplane') ?? (() => {}), needsScan, 'A plane midway between two')}
            {smallSoon('Plane along path', 'elPlane')}
            {smallSoon('Plane through sketch line', 'elPlane')}
          </div>
          <div className="ribbon-text-stack">{smallSoon('Plane from 2D sketch', 'elPlane')}</div>
          {tool('Cylinder', 'elCylinder', fitKind('cylinder'), needsScan, 'Opens the cylinder editor (fit to the scan)')}
          <div className="ribbon-text-stack">
            {smallText('Cone', 'elCone', fitKind('cone'), needsScan, 'Opens the cone editor (fit to the scan)')}
            {smallText('Sphere', 'elSphere', fitKind('sphere'), needsScan, 'Opens the sphere editor (fit to the scan)')}
            {smallText('Symmetry Plane', 'elPlane', method('plane-symmetry') ?? (() => {}), needsScan, 'The plane a part mirrors across')}
          </div>
          {tool('Reference Line', 'elLine', method('line-two-points') ?? (() => {}), needsScan, 'A reference line through two points')}
          {tool('Reference Point', 'elPoint', method('point-coords') ?? (() => {}), needsScan, 'A reference point at typed coordinates')}
          <div className="ribbon-text-stack">{(['elPlane', 'elCylinder', 'elCone'] as IconName[]).map((icon) => (
            <button key={icon} className="ribbon-text-key with-icon" disabled title="From a selected CAD face is not built in Quick Scan yet"><Icon name={icon} size={16} /></button>
          ))}</div>
        </Group></>
      : tab === 'freeform' ? freeformTab
      : tab === 'surfacing' ? surfacingTab
      : tab === 'cad' ? cadTab
      : tab === 'settings' ? settingsTab
      : tab === 'help' ? <>
        <Group label="Help">{tool('Help', 'note', () => window.open('https://github.com/stuartraymor/quick-scan#readme', '_blank'), false, 'Quick Scan documentation on GitHub (opens your browser)')}{tool('Shortcuts', 'navigate', () => setHelpDialog('shortcuts'), false, 'Keyboard shortcuts')}{examplesMenu}{updater ? tool(updater.label === 'Check for updates' ? 'Check for Update' : updater.label, 'rotateCw', updater.run, updater.busy, updater.title) : tool('Check for Update', 'rotateCw', () => {}, true, 'Updates are checked by the Windows app')}</Group>
        <Group label="System"><div className="ribbon-text-stack">{textKey('System Log ...', () => setHelpDialog('log'), 'Warnings and errors since Quick Scan started')}{textKey('Reset layout...', () => { if (window.confirm('Reset the layout? The ribbon returns to the Main tab and the tool panel is put back.')) useShell.getState().resetLayout() }, 'Put the ribbon tab and tool panel back as they start')}{textKey('Change log', () => setHelpDialog('changelog'), 'What changed in each release')}</div></Group>
        <Group label="About"><div className="ribbon-text-stack">{textKey('Credits ...', () => useStore.getState().openImprint(true), 'Licences, attribution and imprint')}{textKey('About ...', () => setAbout(true), 'Version and licence')}</div></Group></>
      : tab === 'ai' ? <>{fileGroup}
        <Group label="Connection">{tool(agentLink ? 'Disconnect AI' : 'Connect AI', 'navigate', () => usePrefs.getState().setAgentLink(!agentLink), busy, agentLink ? `${AGENT_STATUS[agent.status]} — click to switch the AI connection off` : 'Let an AI app on this computer drive Quick Scan (scanruler connector)')}{tool('AI settings', 'settings', () => usePrefs.getState().openSettings(true), false, 'Port, token and data permissions (Settings → Agents)')}</Group>
        <Group label="Rebuild">{tool('Rebuild with AI', 'model', () => setAiWizard(true), false, 'Step by step: connect, add the connector to your AI app, leave notes, ask it to rebuild')}</Group>
        <Group label="Notes">{agentLink ? <>{cad('note', 'Add note', 'note')}{cad('notes', 'Notes', 'labels')}</> : <>{tool('Add note', 'note', () => {}, true, 'Switch the AI connection on first')}{tool('Notes', 'labels', () => {}, true, 'Switch the AI connection on first')}</>}</Group>
        <div className="desktop-ribbon-group ai-status" data-test="ai-ribbon-status"><span title={agentHint}>{!agentLink?'AI connection off':agent.status==='refused'?'AI: check pairing':agentHint.includes("isn't running")?'AI: restart your AI app':`AI: ${AGENT_STATUS[agent.status]}`}</span>{agentLink&&(agent.status==='refused'||agentHint.includes("isn't running"))&&<button onClick={()=>setAiWizard(true)}>Set up my AI app</button>}</div></>
      // Analysis, and the former Wall Thickness / 2D Measure tabs, which now live in it.
      : analysisTab}
    {helpDialog && <HelpDialog id={helpDialog} onClose={() => setHelpDialog(null)} />}
    {about && <div className="modalback" data-test="about-dialog" onClick={() => setAbout(false)}><div className="modal about-quick-scan" role="dialog" aria-label="About Quick Scan" onClick={e => e.stopPropagation()}><h2>Quick Scan v{APP_VERSION}</h2><p>Reverse engineering for 3D scans, laid out for QUICKSURFACE users. Built on ScanRuler by Stefan Hermann (CNC Kitchen), AGPL-3.0-only.</p><p>Quick Scan is independent and is not affiliated with or endorsed by KVS Ltd / QUICKSURFACE.</p><div className="toolrow"><button onClick={() => useStore.getState().openImprint(true)}>Credits</button><button className="primary" data-test="about-close" onClick={() => setAbout(false)}>Close</button></div></div></div>}
    <AiWizard open={aiWizard} onClose={() => setAiWizard(false)} onAddNote={cadActions?.note && !cadActions.note.disabled ? () => { go('reverse'); cadActions.note?.run() } : null} noteDisabledReason={cadActions?.note?.title} />
    <div className="desktop-ribbon-group desktop-ribbon-assistant"><div className="desktop-ribbon-tools">{tool('AI', 'model', () => useShell.getState().setRibbonTab('ai'), false, 'AI tab: connect an AI app, leave notes for it, rebuild with AI')}</div><span className="desktop-ribbon-label">Assistant</span></div>
  </div>
}
