// SPDX-License-Identifier: AGPL-3.0-only
// Prepare Scan as QUICKSURFACE's four-step wizard: the steps in order, the
// buttons each one offers, and leaving it.
import type { ReactNode } from 'react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../src/state/shellStore', async (actual) => {
  const real = await actual<typeof import('../src/state/shellStore')>()
  const live = Object.assign(<T,>(select: (s: ReturnType<typeof real.useShell.getState>) => T) => select(real.useShell.getState()), real.useShell)
  return { ...real, useShell: live }
})
// Render the portal's contents in the static markup harness. The browser
// workflow separately checks placement in the live stage.
vi.mock('react-dom', async original => ({ ...await original<typeof import('react-dom')>(), createPortal: (children: ReactNode) => children }))
beforeAll(() => vi.stubGlobal('document', { querySelector: (s: string) => s === '.stage' ? {} : null }))
afterAll(() => vi.unstubAllGlobals())
const { useShell } = await import('../src/state/shellStore')
const { PrepareScanWizard, PREPARE_STEPS } = await import('../src/ui/PrepareScanWizard')

const at = (step: number | null) => { useShell.setState({ prepareStep: step }); return renderToStaticMarkup(<PrepareScanWizard onStep={() => {}} />) }
const buttons = (html: string) => [...html.matchAll(/data-test="prepare-([a-z]+)"/g)].map((m) => m[1]).filter((b) => b !== 'banner' && b !== 'wizard')

describe('Prepare Scan wizard — QUICKSURFACE parity', () => {
  it('has QUICKSURFACE’s four steps in order', () => {
    expect(PREPARE_STEPS.map((s) => s.title)).toEqual(['Mesh quality', 'Object symmetry', 'Alignment primitives', 'Alignment of scan data'])
  })

  it('offers Next, Next/Skip, Back/Next and Back/Finish in the four tool footers', () => {
    expect(buttons(at(0))).toEqual(['next'])
    expect(buttons(at(1))).toEqual(['next', 'skip'])
    expect(buttons(at(2))).toEqual(['back', 'next'])
    expect(buttons(at(3))).toEqual(['back', 'finish'])
  })

  it('puts the step’s banner over the view', () => {
    expect(at(0)).not.toContain('data-test="prepare-banner"')
    const html = at(1)
    expect(html).toContain('data-test="prepare-banner"')
    expect(html).toContain('Object symmetry')
  })

  it('shows the standalone Edit Scan footer outside the wizard', () => {
    expect(at(null)).toContain('data-test="edit-scan-close"')
    expect(at(null)).not.toContain('data-test="prepare-wizard"')
  })
})
