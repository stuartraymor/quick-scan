// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, expect, it } from 'vitest'
import { usePrefs } from '../../../src/state/prefsStore'
import { useReverse } from '../state/reStore'
import { finishingSizeError, setFinishingFieldError, useFinishingInput } from '../state/finishingInput'

const originalUnits = usePrefs.getState().units
afterEach(() => {
  usePrefs.setState({ units: originalUnits })
  useReverse.getState().reset()
  useFinishingInput.setState({ errors: {} })
})

it('accepts decimal dimensions on the active unit grid and rejects a finer value', () => {
  for (const value of [.001, .039, .125, .250, .375, 1.001]) expect(finishingSizeError(value * 25.4, 'in')).toBeNull()
  expect(finishingSizeError(.0009 * 25.4, 'in')).toContain('0.001 in')
  expect(finishingSizeError(3.21, 'mm')).toBeNull()
  expect(finishingSizeError(3.211, 'mm')).toContain('0.01 mm')
  expect(finishingSizeError(3.21, 'm')).toBeNull()
  expect(finishingSizeError(.001, 'm')).toContain('0.00001 m')
})

it.each(['fillet','chamfer'] as const)('snaps a dragged %s and preserves an untouched archived dimension', kind => {
  usePrefs.setState({ units: 'in' })
  const re = useReverse.getState()
  re.startFeature(kind)
  const size = () => {
    const d = useReverse.getState().featureDraft
    return d?.kind === 'fillet' ? d.radius : d?.kind === 'chamfer' ? d.distance : NaN
  }
  expect(size()).toBeCloseTo(.039 * 25.4, 12)
  const legacy = 2.300446676
  re.setFeatureDraft(kind === 'fillet' ? {radius:legacy} : {distance:legacy})
  re.gripDrag('radius', 0, 'start')
  re.gripDrag('radius', 0, 'move')
  expect(size()).toBe(legacy)
  re.gripDrag('radius', .1234, 'move')
  expect(size()).toBeCloseTo(.095 * 25.4, 12)
  re.gripDrag('radius', -100, 'move')
  expect(size()).toBeCloseTo(.001 * 25.4, 12)
  re.gripDrag('radius', 0, 'end')
})

it('keeps outstanding errors independent across panel dimensions and the grip', () => {
  setFinishingFieldError('distance2', 'Value off grid')
  setFinishingFieldError('grip', 'Enter a size')
  setFinishingFieldError('distance2', null)
  expect(useFinishingInput.getState().errors).toEqual({grip:'Enter a size'})
})
