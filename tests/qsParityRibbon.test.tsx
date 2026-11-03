// SPDX-License-Identifier: AGPL-3.0-only
// The ribbon's QUICKSURFACE layout: each tab's groups, in order, and the
// commands in them — the parity the reviewer checks (docs/QUICKSURFACE_FEATURE_AUDIT.md).
import { describe, expect, it, beforeEach, vi } from 'vitest'
// Rendering to markup runs no effects; the few render-time reads of `window` need only this.
const g = globalThis as unknown as { window?: object }
g.window ??= Object.assign(globalThis, { innerWidth: 1600, innerHeight: 900, addEventListener() {}, removeEventListener() {} })
import { renderToStaticMarkup } from 'react-dom/server'
import { useShell } from '../src/state/shellStore'

// Server rendering reads a store's initial state; the ribbon here reads the
// state each test sets instead.
vi.mock('../src/state/shellStore', async (actual) => {
  const real = await actual<typeof import('../src/state/shellStore')>()
  const live = Object.assign(<T,>(select: (s: ReturnType<typeof real.useShell.getState>) => T) => select(real.useShell.getState()), real.useShell)
  return { ...real, useShell: live }
})
const { DesktopRibbon } = await import('../src/ui/DesktopRibbon')

const noop = () => {}
const props = {
  onFit: noop, onSection: noop, onAlign: noop, onAutoAlign: noop, onFineAlign: noop, onPointAlign: noop,
  onExport: noop, onOpen: noop, onSave: noop, onDeselect: noop, onSnapshot: noop, onSurfaceArea: noop, onVolume: noop, onHideSelected: noop,
  onIsolate: noop, onShowHidden: noop, savable: false,
}
const render = (tab: string) => { useShell.setState({ ribbonTab: tab }); return renderToStaticMarkup(<DesktopRibbon {...props} />) }
const groups = (html: string) => [...html.matchAll(/class="desktop-ribbon-label">([^<]*)</g)].map((m) => m[1])
const tools = (html: string) => [...html.matchAll(/<button class="desktop-ribbon-tool"[^>]*>(?:<[^>]+>)*?<span>([^<]*)<\/span>/g)].map((m) => m[1].replace(/&amp;/g, '&'))

// Every labelled command, large keys and small labelled keys, in document order.
const labels = (html: string) => [...html.matchAll(/<button class="(?:desktop-ribbon-tool|ribbon-text-key with-icon)"[^>]*>(?:<[^>]+>)*?<span>([^<]*)<\/span>/g)].map((m) => m[1].replace(/&amp;/g, '&'))

describe('QUICKSURFACE ribbon parity', () => {
  beforeEach(() => useShell.setState({ ribbonTab: 'main', workspace: 'elements' }))

  it('Main carries QUICKSURFACE’s groups in order', () => {
    expect(groups(render('main'))).toEqual(['File', 'Scan Data', 'Primitives', 'Align', 'Cross sections', 'Surfacing', 'Freeform', 'Part Design', 'Analysis', 'Export Model', 'Assistant'])
  })

  it('Freeform, Surfacing and CAD are three different tabs', () => {
    const freeform = render('freeform'), surfacing = render('surfacing'), cad = render('cad')
    expect(groups(freeform)).toEqual(['Create New Freeform', 'Tools', 'Assistant'])
    expect(groups(surfacing)).toEqual(['Create', 'Tools', 'Assistant'])
    // Checked live against QUICKSURFACE 8.0.128 on 2026-11-02: no File group on CAD.
    expect(groups(cad)).toEqual(['Cross sections', 'Create', 'Edges', 'Patterns', 'Export Model', 'Assistant'])
    expect(labels(freeform)).toEqual(expect.arrayContaining(['New Freeform', 'Auto Freeform', 'Wrap Surface', 'From 3D Sketch', 'From quad OBJ', 'Thicken', 'Offset', 'Convert to CAD body']))
    expect(labels(surfacing)).toEqual(expect.arrayContaining(['Fit Surface', 'Loft', 'Fill Surface', 'From 2D sketch', 'Sweep', 'Pipe', '3D Sketch', 'Helix', 'Roll Sketch', 'Duplicate Face', 'Extend Surface', 'Sew surfaces', 'Flatten', 'Project sketch']))
  })

  it('CAD lists QUICKSURFACE’s Create commands in its order', () => {
    const t = labels(render('cad'))
    // Column order as seen live in QUICKSURFACE 8.0.128 (2026-11-02).
    const order = ['2D Sketch', 'Multiple sections', 'Extrude', 'Revolve', 'Trim', 'Combine', 'Cut', 'Intersect', 'Shell', 'Draft', 'Delete faces', 'Move body', 'Move face', 'Separate bodies', 'Scale body', 'Split solid', 'Fillet / Chamfer', 'Circular pattern', 'Linear pattern', 'Mirror']
    expect(t.filter((x) => order.includes(x))).toEqual(order)
  })

  it('Analysis holds Tools, Control and the Inspection group (Wall thickness, 2D Measure)', () => {
    const html = render('analysis')
    expect(groups(html)).toEqual(['Tools', 'Control', 'Inspection', 'Assistant'])
    const keys = [...html.matchAll(/class="ribbon-text-key[^"]*"[^>]*>(?:<[^>]+>)*([^<]+)</g)].map(m => m[1])
    expect([...tools(html), ...keys]).toEqual(expect.arrayContaining(['Measure', 'Surface Area', 'Volume', 'Zebra Stripes', 'Environment Map', 'Draft', 'Snapshot', 'Compare', 'Compare to other meshes', 'Wall thickness', '2D Measure']))
  })

  it('the former Wall Thickness and 2D Measure tabs show Analysis', () => {
    expect(groups(render('thickness'))).toEqual(groups(render('analysis')))
    expect(groups(render('flat'))).toEqual(groups(render('analysis')))
  })

  it('Settings is a ribbon tab with Display Units and Software Options', () => {
    const html = render('settings')
    expect(groups(html)).toEqual(['Display Units', 'Software Options', 'Assistant'])
    expect(tools(html)).toEqual(expect.arrayContaining(['Millimetres', 'Inches', 'Options']))
  })

  it('Construct matches QUICKSURFACE: From scan data, then the Primitives keys in order', () => {
    const html = render('construct')
    expect(groups(html)).toEqual(['From scan data', 'Primitives', 'Assistant'])
    const keys = [...html.matchAll(/<button class="(?:desktop-ribbon-tool|ribbon-text-key(?: with-icon)?)"[^>]*>(?:<[^>]+>)*?<span>([^<]*)<\/span>/g)].map((m) => m[1])
    expect(keys.slice(0, 12)).toEqual(['Extract primitives', 'Plane', 'Middle plane', 'Plane along path', 'Plane through sketch line', 'Plane from 2D sketch', 'Cylinder', 'Cone', 'Sphere', 'Symmetry Plane', 'Reference Line', 'Reference Point'])
  })

  it('Edit / View exposes Edit and the standard View commands in reference order', () => {
    const html = render('view')
    expect(groups(html).slice(0, 4)).toEqual(['Edit', 'View', 'Background style', 'Display'])
    expect(tools(html).slice(0, 2)).toEqual(['Zoom To Fit', 'Isometric'])
    const keys = [...html.matchAll(/class="ribbon-text-key[^"]*"[^>]*>(?:<[^>]+>)*([^<]+)</g)].map(m => m[1])
    expect(keys.slice(0, 11)).toEqual(['Undo', 'Redo', 'Rebuild', 'Top', 'Left', 'Front', 'Bottom', 'Right', 'Back', 'Linear', 'Studio'])
  })

  it('keeps the AI tab while the Align menu has the four observed reference commands', () => {
    expect(groups(render('ai'))).toEqual(expect.arrayContaining(['Connection', 'Rebuild', 'Notes']))
    const html = render('main')
    const menu = html.match(/data-test="align-menu"[\s\S]*?<\/details>/)?.[0] ?? ''
    expect((menu.match(/data-test="ribbon-/g) ?? []).length).toBe(4)
    expect(menu).not.toContain('Automatic alignment')
    expect(menu).toContain('Align Interactive')
  })

  it('starting a command keeps the current ribbon tab', () => {
    useShell.setState({ ribbonTab: 'main' })
    useShell.getState().setWorkspace('reverse')
    expect(useShell.getState().ribbonTab).toBe('main')
    useShell.getState().setWorkspace('mesh')
    expect(useShell.getState().ribbonTab).toBe('main')
  })
})
