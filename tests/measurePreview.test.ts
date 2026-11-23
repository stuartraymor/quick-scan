// SPDX-License-Identifier: AGPL-3.0-only
// 1.2.24: the Measure store's preview — what a plugin's way would take
// under the cursor — cleared by a change of way and by closing.
import { beforeEach, describe, expect, it } from 'vitest'
import { useMeasureTool, type MeasurePreview } from '../src/state/measureToolStore'

const t = () => useMeasureTool.getState()
const shown: MeasurePreview = { outline: [[[0, 0, 0], [1, 0, 0]]], witness: [[0, 0, 0]], row: { label: 'Radius', value: 3, unit: 'length', exact: true }, sign: 'R' }
beforeEach(() => { t().setOpen(true); t().setMode('plugin:sketch') })

describe('Measure preview', () => {
  it('is kept until the way changes', () => {
    t().setPreview(shown)
    expect(t().preview).toBe(shown)
    t().setMode('3d')
    expect(t().preview).toBeNull()
  })

  it('goes when the dialog closes', () => {
    t().setPreview(shown)
    t().setOpen(false)
    expect(t().preview).toBeNull()
  })

  it('no preview set to none tells no one', () => {
    let told = 0
    const stop = useMeasureTool.subscribe(() => { told++ })
    t().setPreview(null)
    t().setPreview(null)
    stop()
    expect(told).toBe(0)
  })
})
