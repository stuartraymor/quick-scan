// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react'
import { fromDisplay, lengthInputText } from '../core/units'
import { useUnits } from './useUnits'

/** Preserve partially typed text while keeping its physical value when units change. */
export function useLengthDraft(initialMm: number): [string, (text: string) => void, number] {
  const units = useUnits()
  const [draft, setDraft] = useState(() => ({ text: lengthInputText(initialMm, units), units }))
  const mm = fromDisplay(Number(draft.text), draft.units)
  const text = draft.units === units ? draft.text : lengthInputText(mm, units)
  return [text, (next) => setDraft({ text: next, units }), mm]
}
