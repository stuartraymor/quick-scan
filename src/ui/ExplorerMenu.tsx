// SPDX-License-Identifier: AGPL-3.0-only
// The document browser's menus and small dialogs, shared by core and plugin
// rows so every object reads and behaves alike: one right-click menu with
// check items and shortcuts, the Delete confirmation that lists dependents,
// Properties, and the system colour picker behind "Color ...".
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useDismiss } from './useDismiss'

export type ExplorerMenuItem = {
  label: string
  onSelect: () => void
  disabled?: boolean
  /** A check item (Transparent, Wireframe): true shows the tick. */
  checked?: boolean
  shortcut?: string
  danger?: boolean
  testId?: string
  title?: string
} | 'separator'

export interface ExplorerMenuAt { x: number; y: number }

/** Where a menu opened by this right-click goes, kept on screen. */
export function explorerMenuAt(event: ReactMouseEvent, rows = 10): ExplorerMenuAt {
  const height = 34 + rows * 27
  return { x: Math.max(4, Math.min(event.clientX, window.innerWidth - 236)), y: Math.max(4, Math.min(event.clientY, window.innerHeight - height)) }
}

/** Drop separators at the ends and doubled ones left by hidden items. */
function tidy(items: readonly (ExplorerMenuItem | false | null | undefined)[]): ExplorerMenuItem[] {
  const out: ExplorerMenuItem[] = []
  for (const item of items) {
    if (!item) continue
    if (item === 'separator' && (out.length === 0 || out[out.length - 1] === 'separator')) continue
    out.push(item)
  }
  while (out[out.length - 1] === 'separator') out.pop()
  return out
}

export function ExplorerMenu({ at, head, items, onClose, testId }: { at: ExplorerMenuAt; head?: string; items: readonly (ExplorerMenuItem | false | null | undefined)[]; onClose: () => void; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(true, onClose, { outside: '.explorer-core-menu' })
  useEffect(() => { ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true }) }, [])
  const list = tidy(items)
  const move = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    if (buttons.length === 0) return
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    buttons[(at + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus()
  }
  return createPortal(<div ref={ref} role="menu" aria-label={head ? `${head} actions` : 'Object actions'} className="explorer-core-menu" data-test={testId} style={{ left: at.x, top: at.y, zIndex: 1000 }} onKeyDown={move} onContextMenu={event => event.preventDefault()}>
    {head && <div className="explorer-core-menu-head">{head}</div>}
    {list.map((item, index) => item === 'separator'
      ? <div key={`sep-${index}`} role="separator" className="explorer-core-menu-sep" />
      : <button key={item.label} type="button" role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={item.checked} data-test={item.testId} title={item.title} disabled={item.disabled}
          className={item.danger ? 'danger' : undefined}
          onClick={() => { onClose(); item.onSelect() }}>
          <span className="explorer-core-menu-check" aria-hidden="true">{item.checked ? '✓' : item.danger ? '✕' : ''}</span>
          <span className="explorer-core-menu-label">{item.label}</span>
          {item.shortcut && <kbd>{item.shortcut}</kbd>}
        </button>)}
  </div>, document.body)
}

/** Delete confirmation. `also` are the dependents that go with the asked
 *  objects; `blocked` explains a delete that cannot be done, with only OK. */
export function ExplorerDeleteConfirm({ asked, also, blocked, onYes, onNo }: { asked: readonly string[]; also: readonly string[]; blocked?: string | null; onYes: () => void; onNo: () => void }) {
  useDismiss(true, onNo)
  return createPortal(<div className="modalback" data-test="explorer-delete-confirm">
    <div className="modal explorer-confirm" role="dialog" aria-modal="true" aria-label="Delete" onKeyDown={event => {
      event.stopPropagation()
      if (event.key === 'Tab') {
        event.preventDefault()
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
        buttons[(at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus()
      }
    }}>
      <h2>Delete</h2>
      <p>The following group of entities is about to be deleted:</p>
      <p className="explorer-confirm-list" data-test="explorer-delete-asked">{asked.join('; ')};</p>
      {also.length > 0 && <>
        <p>This action will also delete the following entities, since they depend on the above ones:</p>
        <p className="explorer-confirm-list" data-test="explorer-delete-also">{also.join('; ')};</p>
      </>}
      {blocked
        ? <p className="explorer-confirm-blocked" data-test="explorer-delete-blocked">{blocked}</p>
        : <p>Are you sure you want to delete all of the above entities?</p>}
      <div className="toolrow">
        {blocked
          ? <button type="button" data-test="explorer-delete-no" autoFocus onClick={onNo}>OK</button>
          : <>
            <button type="button" data-test="explorer-delete-yes" autoFocus onClick={onYes}>Yes</button>
            <button type="button" data-test="explorer-delete-no" onClick={onNo}>No</button>
          </>}
      </div>
    </div>
  </div>, document.body)
}

export type PropertyRow = readonly [label: string, value: string]

export function ExplorerProperties({ title, rows, onClose }: { title: string; rows: readonly (PropertyRow | null | false)[]; onClose: () => void }) {
  useDismiss(true, onClose)
  return createPortal(<div className="modalback" data-test="explorer-properties">
    <div className="modal explorer-properties" role="dialog" aria-modal="true" aria-label="Properties" onKeyDown={event => event.stopPropagation()}>
      <h2>Properties</h2>
      <dl>{rows.filter((row): row is PropertyRow => Boolean(row)).map(([label, value]) => <div key={label}><dt>{label}</dt><dd data-test={`explorer-property-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>{value}</dd></div>)}</dl>
      <p className="explorer-properties-title">{title}</p>
      <div className="toolrow"><button type="button" autoFocus data-test="explorer-properties-ok" onClick={onClose}>OK</button></div>
    </div>
  </div>, document.body)
}

/** "#rgb"/"#rrggbb"/"rgb(…)" to "#rrggbb" for the system picker. */
export function hexColor(color: string | null | undefined, fallback = '#7f8c99'): string {
  if (!color) return fallback
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color)
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase()
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase()
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(color)
  if (rgb) return `#${[rgb[1], rgb[2], rgb[3]].map((v) => Math.max(0, Math.min(255, Number(v))).toString(16).padStart(2, '0')).join('')}`
  return fallback
}

/** "Color ...": the system colour dialog through a colour input. The input
 *  stays in the page (hidden) until a colour is chosen or another pick
 *  starts, so a test can set it as the dialog would. */
export function pickColor(initial: string | null | undefined, onPick: (hex: string) => void): void {
  document.querySelectorAll('input[data-test="explorer-color-input"]').forEach((old) => old.remove())
  const input = document.createElement('input')
  input.type = 'color'
  input.value = hexColor(initial)
  input.dataset.test = 'explorer-color-input'
  input.setAttribute('aria-hidden', 'true')
  input.tabIndex = -1
  Object.assign(input.style, { position: 'fixed', left: '-40px', top: '0', width: '1px', height: '1px', opacity: '0' })
  input.addEventListener('change', () => { onPick(input.value.toLowerCase()); input.remove() }, { once: true })
  document.body.appendChild(input)
  try { input.click() } catch { /* the picker may be refused outside a gesture */ }
}
