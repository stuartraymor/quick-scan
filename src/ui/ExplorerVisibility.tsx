// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, type ReactNode } from 'react'

/** Checkboxes reflect actual leaf visibility, including explicit view masks. */
export function ExplorerCheckbox({ values, label, disabled, onSet, testId }: { values: readonly boolean[]; label: string; disabled?: boolean; onSet: (shown: boolean) => void; testId?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  const checked = values.length > 0 && values.every(Boolean)
  const mixed = values.some(Boolean) && !checked
  useEffect(() => { if (ref.current) ref.current.indeterminate = mixed }, [mixed])
  return <input ref={ref} type="checkbox" className="explorer-checkbox" data-test={testId} checked={checked} aria-label={label} aria-checked={mixed ? 'mixed' : checked} disabled={disabled || values.length === 0} onClick={event => event.stopPropagation()} onChange={event => onSet(event.currentTarget.checked)} />
}

export function ExplorerGroup({ label, values, disabled, onSet, children, testId }: { label: string; values: readonly boolean[]; disabled?: boolean; onSet: (shown: boolean) => void; children: ReactNode; testId?: string }) {
  if (values.length === 0) return null
  return <details className="explorer-group" open data-test={testId}>
    <summary><ExplorerCheckbox values={values} label={`${label} visibility`} disabled={disabled} onSet={onSet} /><span>{label}({values.length})</span></summary>
    <div className="explorer-children">{children}</div>
  </details>
}
