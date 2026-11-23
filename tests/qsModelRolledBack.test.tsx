// SPDX-License-Identifier: AGPL-3.0-only
// Rolled back, the model is only looked at (1.2.12): the ribbon's modelling
// tabs and the tool panel are inert, and an inert element shows no tooltip —
// so the reason is said in plain sight, each time with the one key that
// brings the tools back, To End of Model, outside anything made inert.
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const g = globalThis as unknown as { window?: object }
g.window ??= Object.assign(globalThis, { innerWidth: 1600, innerHeight: 900, addEventListener() {}, removeEventListener() {} })
vi.mock('../src/state/shellStore', async (actual) => {
  const real = await actual<typeof import('../src/state/shellStore')>()
  const live = Object.assign(<T,>(select: (s: ReturnType<typeof real.useShell.getState>) => T) => select(real.useShell.getState()), real.useShell)
  return { ...real, useShell: live }
})
// A server render reads a store's initial state; these read the live one.
vi.mock('../src/state/documentOrderStore', async (actual) => {
  const real = await actual<typeof import('../src/state/documentOrderStore')>()
  const live = Object.assign(<T,>(select: (s: ReturnType<typeof real.useDocumentOrder.getState>) => T) => select(real.useDocumentOrder.getState()), real.useDocumentOrder)
  return { ...real, useDocumentOrder: live }
})
const { useShell } = await import('../src/state/shellStore')
const { useDocumentOrder } = await import('../src/state/documentOrderStore')
const { ModelRolledBar } = await import('../src/ui/ModelRolledBar')
const { ToolInspector } = await import('../src/ui/ToolInspector')

const inspector = () => renderToStaticMarkup(<ToolInspector><p data-test="panel-content">content</p></ToolInspector>)

describe('a rolled-back model says so, with To End of Model', () => {
  it('shows no strip while End of Model is at the end', () => {
    useDocumentOrder.setState({ rollbackAt: null })
    expect(renderToStaticMarkup(<ModelRolledBar />)).toBe('')
  })

  it('shows the strip under the ribbon, with its key, while rolled back', () => {
    useDocumentOrder.setState({ rollbackAt: 2 })
    const html = renderToStaticMarkup(<ModelRolledBar />)
    expect(html).toContain('data-test="model-rolled-bar"')
    expect(html).toContain('role="status"')
    expect(html).toContain('The model is rolled back')
    expect(html).toMatch(/<button[^>]*data-test="model-rolled-to-end"[^>]*>To End of Model<\/button>/)
    expect(html).not.toContain('inert')
  })

  it('puts To End of Model on the panel’s lock line, outside the inert controls', () => {
    useShell.setState({ extractOpen: false, inspectorOpen: true })
    useDocumentOrder.setState({ rollbackAt: 2 })
    const html = inspector()
    const lock = html.indexOf('data-test="model-history-edit-lock"')
    const key = html.indexOf('data-test="model-history-to-end"')
    const inert = html.indexOf('inert=""')
    expect(lock).toBeGreaterThan(-1)
    expect(key).toBeGreaterThan(lock)
    // The key comes before, not inside, the inert wrapper of the panel's
    // own controls.
    expect(inert).toBeGreaterThan(key)
    expect(html.indexOf('data-test="panel-content"')).toBeGreaterThan(inert)
  })

  it('has no lock line and nothing inert at the end', () => {
    useDocumentOrder.setState({ rollbackAt: null })
    const html = inspector()
    expect(html).not.toContain('model-history-edit-lock')
    expect(html).not.toContain('inert=""')
  })
})
