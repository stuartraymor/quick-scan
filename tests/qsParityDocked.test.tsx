// SPDX-License-Identifier: AGPL-3.0-only
// One command panel, as in QUICKSURFACE: while Extract primitives is open it
// takes the tool panel over — its title, its slot shown, the panel's own
// contents put away.
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const g = globalThis as unknown as { window?: object }
g.window ??= Object.assign(globalThis, { innerWidth: 1600, innerHeight: 900, addEventListener() {}, removeEventListener() {} })
vi.mock('../src/state/shellStore', async (actual) => {
  const real = await actual<typeof import('../src/state/shellStore')>()
  const live = Object.assign(<T,>(select: (s: ReturnType<typeof real.useShell.getState>) => T) => select(real.useShell.getState()), real.useShell)
  return { ...real, useShell: live }
})
const { useShell } = await import('../src/state/shellStore')
const { ToolInspector } = await import('../src/ui/ToolInspector')

const render = () => renderToStaticMarkup(<ToolInspector><p data-test="panel-content">content</p></ToolInspector>)

describe('docked command panel — QUICKSURFACE parity', () => {
  it('shows the panel’s own contents when no command is docked', () => {
    useShell.setState({ extractOpen: false, inspectorOpen: true })
    const html = render()
    expect(html).toMatch(/data-test="inspector-command-slot"[^>]*hidden/)
    expect(html).not.toMatch(/class="inspector-body" hidden/)
  })

  it('gives the panel over to Extract primitives while it is open', () => {
    useShell.setState({ extractOpen: true, inspectorOpen: true })
    const html = render()
    expect(html).toContain('aria-label="Extract primitives"')
    expect(html).not.toMatch(/data-test="inspector-command-slot"[^>]*hidden/)
    expect(html).toMatch(/class="inspector-body" hidden/)
  })
})
