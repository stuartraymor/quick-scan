// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState, type ReactNode } from 'react'
import { useStore } from '../state/store'
import { useShell } from '../state/shellStore'
import { usePrefs } from '../state/prefsStore'
import { useDeviation } from '../state/deviationStore'
import { plugins } from '../plugins/registry'
import type { ElementKind } from '../core/types'
import type { PluginRuntime } from '../plugins/api'
import { CREATION_METHODS } from '../core/elements/construct'
import { Icon, type IconName } from './icons'

type Props = {
  onFit: (kind: ElementKind) => void
  onSection: () => void
  onAlign: () => void
  onAutoAlign: () => void
  onFineAlign: () => void
  onPointAlign: () => void
  onExport: () => void
  onOpen: () => void
  onSave: () => void
  onDeselect: () => void
  savable: boolean
  pluginTools?: ReactNode
  cadActions?: PluginRuntime['ribbonActions']
}
function Group({ label, children }: { label: string; children: ReactNode }) {
  return <div className="desktop-ribbon-group"><div className="desktop-ribbon-tools">{children}</div><span className="desktop-ribbon-label">{label}</span></div>
}

/** Familiar command positions, backed by the existing session and plugin verbs. */
export function DesktopRibbon({ onFit, onSection, onAlign, onAutoAlign, onFineAlign, onPointAlign, onExport, onOpen, onSave, onDeselect, savable, pluginTools, cadActions }: Props) {
  const file = useStore(s => s.fileName)
  const busy = useStore(s => s.busy)
  const drafting = useStore(s => Boolean(s.draft || s.sectionDraft || s.alignDraft || s.dimDraft))
  const tab = useShell(s => s.ribbonTab)
  const picking = useDeviation(s => s.picking)
  const hasReference = useDeviation(s => Boolean(s.nominalName))
  const wireframe = useStore(s => s.wireframe)
  const translucent = useStore(s => s.translucent)
  const [pending, setPending] = useState<string | null>(null)
  const locked = busy || picking || drafting
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
  const tool = (label: string, icon: IconName, action: () => void, disabled = false, hint = label) => (
    <button className="desktop-ribbon-tool" key={label} disabled={disabled} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); useShell.getState().setInspectorOpen(true); action() }}
      title={hint} data-test={`ribbon-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
      <Icon name={icon} size={25} /><span>{label}</span>
    </button>
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
    const action = cadActions?.[pending]
    if (!action) { setPending(null); return }
    if (action.title?.includes('CAD kernel') || action.title === 'Finish the current operation first.') return
    if (action.disabled) useStore.getState().setStatus(action.title || 'Finish the current operation first.')
    else action.run()
    setPending(null)
  }, [pending, cadActions])
  useEffect(() => {
    if (!pending) return
    const timer = setTimeout(() => { setPending(null); useStore.getState().setStatus('CAD initialization is taking longer than expected. Check the CAD tool panel.'); }, 30000)
    return () => clearTimeout(timer)
  }, [pending])
  const cad = (id: string, label: string, icon: IconName, scanRequired = false) => {
    const action = cadActions?.[id]
    const loading = action?.title?.includes('CAD kernel')
    const disabled = locked || !!pending || !action || (scanRequired && !file) || (action.disabled && !loading)
    return tool(label, icon, () => {
      go('reverse')
      if (loading) { setPending(id); useStore.getState().setStatus(`Preparing CAD tools for ${label}…`) }
      else action?.run()
    }, disabled, action?.title || `${label} — open its contextual editor`)
  }
  const primitives = <details className="ribbon-dropdown"><summary className="desktop-ribbon-tool" title="Extract fitted geometry from scan data"><Icon name="extract" size={25} /><span>Extract<br/>primitives ▾</span></summary><div className="ribbon-menu">
    {(['plane', 'cylinder', 'cone', 'sphere', 'circle', 'torus', 'line', 'point'] as ElementKind[]).map(kind => <button key={kind} disabled={needsScan} onClick={e => { e.currentTarget.closest('details')?.removeAttribute('open'); go('elements'); onFit(kind) }}>{kind[0].toUpperCase() + kind.slice(1)}</button>)}
  </div></details>
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
  const alignMenu = <details className="ribbon-dropdown"><summary className="desktop-ribbon-tool" title="Choose an alignment method"><Icon name="alignSheet" size={25}/><span>Align ▾</span></summary><div className="ribbon-menu">
    {tool('Align by Coordinate System …', 'alignSheet', () => { go('elements'); onAlign() }, needsScan, 'Pick primary, secondary and tertiary features, preview, then Apply')}
    {tool('Align Interactive…', 'navigate', () => { go('elements'); setTimeout(() => document.querySelector<HTMLButtonElement>('[data-test="start-manual"]')?.click(), 50) }, needsScan, 'Reposition the scan by hand. Quick Scan opens its move / rotate-by-numbers editor here; a draggable gizmo is not built yet')}
    {tool('By N points …', 'pickPoints', () => { go('deviation'); onPointAlign() }, needsScan || !hasReference, 'Requires a loaded scan and reference model; pick corresponding points')}
    {tool('Fine-align reference mesh …', 'compare', () => { go('deviation'); onFineAlign() }, needsScan || !hasReference, 'Requires a loaded scan and reference model; run the existing best fit')}
    <hr />
    {tool('Automatic alignment (Quick Scan)', 'scan', () => { go('elements'); onAutoAlign() }, needsScan, 'Not in QUICKSURFACE: propose datums from the scan and review before applying')}
  </div></details>
  const surfacingMenu = <details className="ribbon-dropdown"><summary className="desktop-ribbon-tool" title="Surface creation and editing"><Icon name="loft" size={25}/><span>Surfacing ▾</span></summary><div className="ribbon-menu">
    {cad('surface','Fit Surface','surface',true)}{cad('sheet','Extruded surface','sheet')}{cad('loft','Loft','loft')}{cad('sweep','Sweep','spline')}{cad('network','Patch network','surface',true)}{cad('thicken','Thicken surface','shell')}
  </div></details>
  const patternMenu = <details className="ribbon-dropdown"><summary className="desktop-ribbon-tool" title="Patterns and mirror"><Icon name="pattern" size={25}/><span>Pattern ▾</span></summary><div className="ribbon-menu">{cad('pattern','Linear / circular pattern','pattern')}{cad('mirror','Mirror','mirror')}</div></details>
  const fileGroup = <Group label="File">{tool('Open', 'load', onOpen, busy || picking, 'Open a scan or project')}{tool('Save', 'save', onSave, busy || !savable, 'Save the entire Quick Scan project')}</Group>
  const analysis = <Group label="Analysis">{tool('Compare', 'compare', () => go('deviation'), locked, 'Compare scan data with CAD or fitted geometry')}</Group>
  const exportGroup = <Group label="Export Model">{cadActions ? cad('export', 'Export', 'exportStep') : tool('Export', 'exportStep', onExport, needsScan)}</Group>
  const scanGroup = <Group label="Scan Data">{tool('Prepare Scan', 'reduceMesh', () => mesh && go(mesh.id), locked || !mesh, 'Open scan preparation and polygon reduction')}{tool('Edit Scan', 'wsMesh', () => mesh && go(mesh.id), locked || !mesh, 'Open mesh selection, repair and editing')}{tool('Deselect All', 'select', onDeselect, needsScan, 'Clear the painted scan selection')}</Group>
  const main = <>
    {fileGroup}{scanGroup}
    <Group label="Primitives">{primitives}{construct}</Group>
    <Group label="Align">{alignMenu}</Group>
    <Group label="Cross sections">{cad('sketch', '2D Sketch', 'sketch')}{tool('Multiple sections', 'section', () => { go('elements'); onSection() }, needsScan, 'Create planar cross sections; stacked sections are not yet implemented')}</Group>
    <Group label="Surfacing">{cad('surface', 'Fit Surface', 'surface', true)}{surfacingMenu}</Group>
    <Group label="Freeform">{tool('New Freeform', 'surface', () => {}, true, 'Quad-based freeform surfacing is not implemented in Quick Scan yet')}{tool('Auto Freeform', 'spline', () => {}, true, 'Automatic freeform surfacing is not implemented in Quick Scan yet')}</Group>
    <Group label="Part Design">{cad('extrude', 'Extrude', 'extrude')}{cad('revolve', 'Revolve', 'revolve')}{cad('moveFace', 'Move face', 'moveFace')}{tool('Trim', 'trim', () => {}, true, 'Mutual trimming is not implemented in Quick Scan yet')}{patternMenu}{cad('fillet', 'Fillet / Chamfer', 'fillet')}</Group>
    {analysis}{exportGroup}
  </>
  return <div className="desktop-ribbon" aria-label="Workspace tools">
    {tab === 'main' ? main : tab === 'view' ? <>
      {fileGroup}<Group label="Display">{tool(wireframe ? 'Solid view' : 'Wireframe', 'mesh', () => useStore.getState().setWireframe(!wireframe), !file)}{tool(translucent ? 'Opaque' : 'Transparent', 'transparent', () => useStore.getState().setTranslucent(!translucent), !file)}{tool('Show scan', 'eye', () => useStore.getState().setScanHidden(false), !file)}{tool('Hide scan', 'eyeOff', () => useStore.getState().setScanHidden(true), !file)}</Group>
      <Group label="Navigation">{tool('Mouse controls', 'navigate', () => usePrefs.getState().openSettings(true), false, 'Configure navigation and display preferences')}</Group>
    </> : tab === 'scan' ? <>{fileGroup}{scanGroup}<Group label="Cross sections">{tool('Multiple sections', 'section', () => { go('elements'); onSection() }, needsScan)}</Group>{analysis}</>
      : tab === 'construct' ? <>{fileGroup}<Group label="Extract primitives">{primitives}{(['plane','cylinder','sphere','cone'] as ElementKind[]).map(kind => tool(kind[0].toUpperCase()+kind.slice(1), ({plane:'elPlane',cylinder:'elCylinder',sphere:'elSphere',cone:'elCone'} as Record<string,IconName>)[kind], () => { go('elements'); onFit(kind) }, needsScan))}</Group><Group label="Alignment">{tool('Align', 'alignSheet', () => { go('elements'); onAlign() }, needsScan)}</Group></>
      : ['cad','surfacing','freeform'].includes(tab) ? <>{fileGroup}{pluginTools}{analysis}{exportGroup}</>
      : tab === 'analysis' ? <>{fileGroup}
        <Group label="Tools">{tool('Measure', 'wsMeasure', () => go('elements'), locked, 'Measure distances between fitted elements in 3D Measure')}{tool('Surface Area', 'mesh', () => {}, true, 'Not implemented yet')}{tool('Volume', 'mesh', () => {}, true, 'Not implemented yet')}{tool('Zebra Stripes', 'mesh', () => {}, true, 'Not implemented yet')}{tool('Environment Map', 'eye', () => {}, true, 'Not implemented yet')}{tool('Draft', 'transparent', () => {}, true, 'Not implemented yet')}{tool('Snapshot', 'save', () => {}, true, 'Not implemented yet')}</Group>
        <Group label="Control">{tool('Compare', 'compare', () => go('deviation'), locked, 'Compare scan data with CAD or fitted geometry')}{tool('Compare to other meshes', 'compare', () => go('deviation'), locked, 'Compare the scan with a second mesh in Surface Deviation')}</Group></>
      : <>{fileGroup}<Group label="Inspection">{tool('Compare', 'compare', () => go('deviation'), locked)}{tool('Wall thickness', 'wsThickness', () => go('thickness'), locked)}{tool('2D Measure', 'wsFlat', () => go('flat'), locked)}</Group>{exportGroup}</>}
    <div className="desktop-ribbon-group desktop-ribbon-assistant"><div className="desktop-ribbon-tools">{tool('AI connection', 'settings', () => usePrefs.getState().openSettings(true), busy, 'Configure the existing AI agent connection in Settings')}</div><span className="desktop-ribbon-label">Assistant</span></div>
  </div>
}
