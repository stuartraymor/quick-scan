// SPDX-License-Identifier: AGPL-3.0-only
// The field every number of the workspace is typed into: a number, or an
// expression — `25.4/12`, `height + 5`, `sin(30) * r` — read by
// core/expression against the model's parameters. A plain number is handed
// on as one; anything else is handed on with the expression beside it, and
// the field keeps showing the expression, the value it comes to written
// where the unit was. An expression that cannot be read stays in the field
// with why under it, until it is put right or Escape puts the old text
// back. The parameters' names are offered as the field is typed into.
//
// A length field holds millimetres and shows and takes the display units,
// writing their word itself; how typed text in inches is kept is said in
// reLength.ts.

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useUnits } from '../../../src/app/useUnits'
import { unitWord } from '../../../src/core/units'
import { formatValue, type ParameterKind } from '../core/expression'
import { useReverse } from '../state/reStore'
import { finishingSizeError, setFinishingFieldError } from '../state/finishingInput'
import { fieldText, isNumericLiteral, readField } from './reLength'

/** The id of the datalist of parameter names, rendered once by the
 *  parameter list. */
export const PARAMETER_NAMES_LIST = 're-parameter-names'

export function ExprInput({
  value,
  expr,
  kind,
  unit,
  testId,
  places = 3,
  min,
  dataDimension,
  passKeys,
  onCommit,
  onEnter,
  live = false,
  finishingLength = false,
}: {
  value: number
  /** The expression behind the value, or none. */
  expr?: string
  kind: ParameterKind
  /** Written after the number — "°", "%" — while no expression is set;
   *  with one, the value it comes to is written there instead. A length
   *  field writes the display unit's word whatever is given, but for "",
   *  which leaves the word to the label. */
  unit?: string
  testId: string
  places?: number
  min?: number
  dataDimension?: number
  /** For a field that takes the keys by itself as its box opens: while
   *  nothing is typed into it, the keys it has no use for do what they do
   *  in the box — Escape goes on to close the box, and Enter does `enter`,
   *  the box's own Enter — as if the field had not taken them. */
  passKeys?: { enter: () => void }
  /** The number read, and the expression it was typed as — null for a
   *  plain number. */
  onCommit: (value: number, expr: string | null) => boolean | void
  /** Enter, once the text has been taken. */
  onEnter?: () => void
  live?: boolean
  finishingLength?: boolean
}) {
  const scope = useReverse((s) => s.parameterTable.scope)
  const units = useUnits()
  const [error, setError] = useState<string | null>(null)
  const shown = expr ?? fieldText(value, kind, places, units)
  const field = useRef<HTMLInputElement>(null)
  const original = useRef({ value, expr })
  useLayoutEffect(() => {
    if (live && field.current && document.activeElement !== field.current) field.current.value = shown
  }, [live, shown])
  const word = unit === '' ? '' : kind === 'length' ? unitWord(units) : (unit ?? '')
  const result = formatValue(value, kind, units)
  // Whether the box was typed in since it last showed its value. The box
  // shows a rounded number: one typed over with the same figures is meant
  // exactly — "6" over a stored 5.9999997 makes it 6 — while a box only
  // looked at changes nothing.
  useLayoutEffect(() => {
    if (!finishingLength) return
    return () => setFinishingFieldError(testId, null)
  }, [finishingLength, testId, units])
  const validate = (text: string) => {
    const r = readField(text, kind, scope, units)
    if (!finishingLength) return r
    const message = !text ? 'Enter a size.' : !r.ok ? r.error : finishingSizeError(r.value, units)
    setFinishingFieldError(testId, message)
    return message ? { ok: false as const, error: message } : r
  }
  const typedIn = useRef(false)
  const take = (input: HTMLInputElement): boolean => {
    const t = input.value.trim()
    const retyped = !live && typedIn.current && !expr && t === shown
    typedIn.current = false
    if ((!finishingLength && t === '') || (t === shown && !retyped && !error)) {
      if (finishingLength) setFinishingFieldError(testId, null)
      setError(null)
      return true
    }
    const r = validate(t)
    if (!r.ok) {
      setError(r.error)
      return false
    }
    setError(null)
    if (live && r.value === value && (r.expr ?? null) === (expr ?? null)) return true
    if (min !== undefined && r.value < min) {
      if (r.expr && !isNumericLiteral(t)) {
        setError('The expression gives a depth below zero.')
        return false
      }
      input.value = fieldText(min, kind, places, units)
    }
    const limited = min !== undefined && r.value < min
    if (onCommit(limited ? min : r.value, limited ? null : r.expr) === false) {
      // A refused edit keeps the previous model value, so the input key
      // stays the same. Restore its displayed value explicitly.
      input.value = shown
      return false
    }
    return true
  }
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    const untouched = e.currentTarget.value === shown && !error
    if (e.key === 'Enter') {
      if (passKeys && untouched) {
        e.currentTarget.blur()
        passKeys.enter()
      } else if (take(e.currentTarget)) {
        onEnter?.()
        e.currentTarget.blur()
      }
    } else if (e.key === 'Escape') {
      if (passKeys && untouched) return
      // The field's own: the old text comes back, and the key goes no
      // further to put a tool or a selection down.
      e.preventDefault()
      if (finishingLength) setFinishingFieldError(testId, null)
      if (live) {
        onCommit(original.current.value, original.current.expr ?? null)
        e.currentTarget.value = original.current.expr ?? fieldText(original.current.value, kind, places, units)
        typedIn.current = false
      } else e.currentTarget.value = shown
      setError(null)
      if (!finishingLength) e.currentTarget.blur()
    }
  }
  return (
    <>
      <span className={'unitfield' + (expr ? ' expr' : '')}>
        <input
          type="text"
          inputMode="decimal"
          spellCheck={false}
          autoComplete="off"
          list={PARAMETER_NAMES_LIST}
          data-test={testId}
          aria-invalid={finishingLength && error ? true : undefined}
          data-dimension={dataDimension}
          data-pass-undo={shown}
          ref={field}
          key={live ? testId + (finishingLength ? units : '') : shown}
          defaultValue={shown}
          title={expr ? `${expr} = ${result}` : undefined}
          onFocus={() => { original.current = { value, expr } }}
          onInput={e => {
            typedIn.current = true
            if (!live && !finishingLength) return
            const text = e.currentTarget.value.trim()
            const read = validate(text)
            if (finishingLength) setError(read.ok ? null : read.error)
            if (!live) return
            if (text && read.ok && (min === undefined || read.value >= min)) {
              setError(null)
              onCommit(read.value, read.expr)
            }
          }}
          onBlur={(e) => take(e.currentTarget)}
          onKeyDown={keys}
        />
        <i>{expr ? `= ${result}` : word}</i>
      </span>
      {error && (
        <span className="hint warn exprerror" data-test={`${testId}-error`}>
          {error}
        </span>
      )}
    </>
  )
}
