// SPDX-License-Identifier: AGPL-3.0-only
// Prepare Scan as QUICKSURFACE's four-step wizard: the steps in order, the
// buttons each one offers, and leaving it.
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../src/state/shellStore', async (actual) => {
  const real = await actual<typeof import('../src/state/shellStore')>()
  const live = Object.assign(<T,>(select: (s: ReturnType<typeof real.useShell.getState>) => T) => select(real.useShell.getState()), real.useShell)
  return { ...real, useShell: live }
})
const { useShell } = await import('../src/state/shellStore')
const { PrepareScanWizard, PREPARE_STEPS } = await import('../src/ui/PrepareScanWizard')

const at = (step: number | null) => { useShell.setState({ prepareStep: step }); return renderToStaticMarkup(<PrepareScanWizard onStep={() => {}} />) }
const buttons = (html: string) => [...html.matchAll(/data-test="prepare-([a-z]+)"/g)].map((m) => m[1]).filter((b) => b !== 'banner' && b !== 'wizard')

describe('Prepare Scan wizard — QUICKSURFACE parity', () => {
  it('has QUICKSURFACE’s four steps in order', () => {
    expect(PREPARE_STEPS.map((s) => s.title)).toEqual(['Mesh quality', 'Object symmetry', 'Alignment primitives', 'Alignment of scan data'])
  })

  it('offers Next on step 1, Back/Skip/Next on symmetry, Back/Next on primitives, Back/Finish on alignment', () => {
    expect(buttons(at(0))).toEqual(['x', 'next'])
    expect(buttons(at(1))).toEqual(['x', 'back', 'skip', 'next'])
    expect(buttons(at(2))).toEqual(['x', 'back', 'next'])
    expect(buttons(at(3))).toEqual(['x', 'back', 'finish'])
  })

  it('puts the step’s banner over the view', () => {
    const html = at(0)
    expect(html).toContain('data-test="prepare-banner"')
    expect(html).toContain('Mesh quality')
  })

  it('shows nothing when not running', () => {
    expect(at(null)).toBe('')
  })
})
