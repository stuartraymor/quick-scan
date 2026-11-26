// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand'
import { fromDisplay, unitWord, type DisplayUnits } from '../../../src/core/units'

/** Manual finishing sizes use one hundredth of a millimetre or one thousandth of an inch. */
export function finishingIncrement(units: DisplayUnits): number {
  return units === 'in' ? fromDisplay(.001, units) : .01
}

export function snapFinishingSize(mm: number, units: DisplayUnits): number {
  const step = finishingIncrement(units)
  return Math.round(mm / step) * step
}

export function finishingSizeError(mm: number, units: DisplayUnits): string | null {
  const nearest = snapFinishingSize(mm, units)
  if (Math.abs(mm - nearest) <= 8 * Number.EPSILON * Math.max(1, Math.abs(mm))) return null
  const increment = units === 'in' ? '0.001' : units === 'm' ? '0.00001' : '0.01'
  return `Enter a size in increments of ${increment} ${unitWord(units)}.`
}

/** An invalid panel or viewport field prevents applying a previously valid prefix. */
export const useFinishingInput = create<{ errors: Record<string, string> }>(() => ({ errors: {} }))

export function setFinishingFieldError(id: string, message: string | null) {
  useFinishingInput.setState(state => {
    if ((state.errors[id] ?? null) === message) return state
    const errors = { ...state.errors }
    if (message) errors[id] = message
    else delete errors[id]
    return { errors }
  })
}
