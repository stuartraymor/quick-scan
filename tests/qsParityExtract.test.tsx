// SPDX-License-Identifier: AGPL-3.0-only
// Extract primitives as QUICKSURFACE runs it: select, click a type to
// preview the fit, Create to keep it; the selection tools and options in
// QUICKSURFACE's order.
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const g = globalThis as unknown as { window?: object }
g.window ??= Object.assign(globalThis, { innerWidth: 1600, innerHeight: 900, addEventListener() {}, removeEventListener() {} })

// Server rendering reads a store's initial state; read the live one instead.
const live = async <M extends Record<string, unknown>>(actual: () => Promise<M>, key: string) => {
  const real = await actual()
  const store = real[key] as { getState: () => unknown }
  return { ...real, [key]: Object.assign(<T,>(select?: (s: never) => T) => (select ? select(store.getState() as never) : store.getState()), store) }
}
vi.mock('../src/state/shellStore', (a) => live(a as () => Promise<Record<string, unknown>>, 'useShell'))
vi.mock('../src/state/markStore', (a) => live(a as () => Promise<Record<string, unknown>>, 'useMark'))
vi.mock('../src/state/prefsStore', (a) => live(a as () => Promise<Record<string, unknown>>, 'usePrefs'))

const { useShell } = await import('../src/state/shellStore')
const { useMark } = await import('../src/state/markStore')
const { usePrefs } = await import('../src/state/prefsStore')
const { ExtractPrimitives } = await import('../src/ui/ExtractPrimitives')

const noop = () => {}
const render = (preview: { kind: 'plane' | 'cylinder'; sigma: number | null } | null = null) =>
  renderToStaticMarkup(<ExtractPrimitives onType={noop} preview={preview} onCreate={() => true} onClearPreview={noop} onClose={noop} onClear={noop} fitting={false} onHide={noop} onIsolate={noop} onShowAll={noop} onAnalyse={noop} onAnalysisOff={noop} />)
const tests = (html: string) => [...html.matchAll(/data-test="(extract-[a-z-]+)"/g)].map((m) => m[1])

describe('Extract primitives — QUICKSURFACE parity', () => {
  useShell.setState({ extractOpen: true })

  it('defaults the Magic Wand to 1 degree, as QUICKSURFACE 8.0.128 opens (live, 2026-11-03)', () => {
    expect(useMark.getState().wandDegrees).toBe(1)
  })

  it('has the selection options in QUICKSURFACE’s order, ending with Select all', () => {
    const t = tests(render()).filter((x) => ['extract-enlarge', 'extract-shrink', 'extract-isolate', 'extract-hide', 'extract-show-all', 'extract-deselect', 'extract-select-all', 'extract-invert'].includes(x))
    expect(t).toEqual(['extract-enlarge', 'extract-shrink', 'extract-isolate', 'extract-hide', 'extract-show-all', 'extract-deselect', 'extract-select-all'])
  })

  it('lists the primitive types Plane, Cylinder, Line, Cone, Sphere', () => {
    expect(tests(render()).filter((x) => x.startsWith('extract-type-'))).toEqual(['extract-type-plane', 'extract-type-cylinder', 'extract-type-line', 'extract-type-cone', 'extract-type-sphere'])
  })

  it('shows no Create until a type has been previewed', () => {
    expect(render()).not.toContain('data-test="extract-create"')
  })

  it('previews the fit with its sigma and offers Create', () => {
    usePrefs.setState({ units: 'mm' })
    useMark.setState({ count: 120 })
    const html = render({ kind: 'plane', sigma: 0.0194 })
    expect(html).toContain('Plane preview · σ 0.0194 mm')
    expect(html).toContain('data-test="extract-create"')
    expect(html).toMatch(/data-test="extract-type-plane"[^>]*aria-pressed="true"/)
  })

  it('converts fit error to inches without changing the stored millimetre value', () => {
    usePrefs.setState({ units: 'in' })
    const preview = { kind: 'plane' as const, sigma: 0.254 }
    expect(render(preview)).toContain('Plane preview · σ 0.01000 in')
    expect(preview.sigma).toBe(0.254)
    usePrefs.setState({ units: 'mm' })
    expect(render(preview)).toContain('Plane preview · σ 0.2540 mm')
  })

  it('has QUICKSURFACE’s selection tools, with Line and Circle working', () => {
    const html = render()
    for (const t of ['wand', 'brush', 'lasso', 'line', 'window', 'circle', 'through']) expect(html).toMatch(new RegExp(`data-test="extract-tool-${t}"`))
    expect(html).not.toMatch(/data-test="extract-tool-(line|circle)"[^>]*disabled/)
    expect(html).not.toContain('not built in Quick Scan yet')
  })

  it('has QUICKSURFACE’s constraint dropdown, Auto Constrain with its tolerances, and Analysis, in order', () => {
    const html = render()
    const order = tests(html)
    const want = ['extract-type-plane', 'extract-constraint', 'extract-auto-constrain', 'extract-tilt', 'extract-coincidence', 'extract-analysis', 'extract-analysis-tolerance', 'extract-analysis-apply', 'extract-quick-tools', 'extract-labels']
    const at = want.map((k) => order.indexOf(k))
    expect(at.every((i, n) => i >= 0 && (n === 0 || i > at[n - 1]))).toBe(true)
    const options = [...html.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((m) => m[1].replace(/&#x27;/g, "'"))
    expect(options).toEqual(['Not constrained', 'Parallel to (OXY)', 'Parallel to (OYZ)', 'Parallel to (OXZ)', 'Perpendicular to (OXY)', 'Perpendicular to (OYZ)', 'Perpendicular to (OXZ)'])
    // The tolerances start at QUICKSURFACE's 0.5 degrees and 1 mm, off until Auto Constrain is on; Analysis starts at 0.1 mm.
    expect(html).toMatch(/data-test="extract-tilt"[^>]*value="0.5"[^>]*disabled|disabled[^>]*data-test="extract-tilt"/)
    expect(html).toMatch(/data-test="extract-analysis-tolerance"[^>]*value="0.1"/)
    expect(html).toMatch(/data-test="extract-analysis-apply"[^>]*disabled/)
  })
})
