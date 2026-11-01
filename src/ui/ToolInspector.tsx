// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useShell } from '../state/shellStore'
import { useStore } from '../state/store'
import type { PluginRuntime } from '../plugins/api'
import { Icon } from './icons'
import './tool-inspector.css'

/** Modeless controls: docking changes CSS, never the editor or viewport tree. */
export function ToolInspector({ context, children }: { context?: PluginRuntime['toolContext']; children: ReactNode }) {
  const open = useShell(s => s.inspectorOpen)
  const mode = useShell(s => s.inspectorMode)
  const workspace = useShell(s => s.workspace)
  const draft = useStore(s => s.draft)
  const section = useStore(s => s.sectionDraft)
  const align = useStore(s => s.alignDraft)
  const dimension = useStore(s => s.dimDraft)
  const coreTitle = draft ? `${draft.kind[0].toUpperCase()}${draft.kind.slice(1)}` : section ? 'Cross section' : align ? 'Align by coordinate system' : dimension ? 'Dimension' : null
  const title = context?.title || coreTitle || ({ elements: 'Primitives & measurement', deviation: 'Compare', thickness: 'Wall thickness', flat: '2D Measure', reverse: 'CAD tools', mesh: 'Edit scan' } as Record<string, string>)[workspace] || 'Tool properties'
  const activity = context?.key || coreTitle || ''
  const active = Boolean(context?.active || coreTitle)
  const node = useRef<HTMLElement>(null)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null)

  useEffect(() => { if (active) useShell.getState().setInspectorOpen(true) }, [activity, active, workspace])
  useLayoutEffect(() => {
    const parent = node.current?.parentElement
    if (!parent) return
    const fit = () => setPosition(old => {
      if (!old || !node.current) return old
      const x = Math.max(0, Math.min(old.x, Math.max(0, parent.clientWidth - node.current.offsetWidth)))
      const y = Math.max(0, Math.min(old.y, Math.max(0, parent.clientHeight - node.current.offsetHeight)))
      return x === old.x && y === old.y ? old : { x, y }
    })
    const observer = new ResizeObserver(fit)
    observer.observe(parent)
    fit()
    return () => observer.disconnect()
  }, [open, mode])

  return <>
    {!open && <button className="inspector-reopen" data-test="show-tool-inspector" onClick={() => useShell.getState().setInspectorOpen(true)} title={`Show ${title}`}><Icon name="settings" size={16}/><span>{title}</span></button>}
    <section ref={node} className="tool-inspector" hidden={!open} data-mode={mode} data-test="tool-inspector" aria-label={title}
      style={mode === 'floating' && position ? { left: position.x, top: position.y } : undefined}>
      <div className="inspector-titlebar" data-test="inspector-drag-handle"
        onPointerDown={event => {
          if (mode !== 'floating' || event.button !== 0 || (event.target as HTMLElement).closest('button')) return
          const el = node.current!
          drag.current = { x: event.clientX, y: event.clientY, startX: el.offsetLeft, startY: el.offsetTop }
          event.currentTarget.setPointerCapture(event.pointerId)
          event.preventDefault()
        }}
        onPointerMove={event => {
          const start = drag.current, el = node.current, parent = el?.parentElement
          if (!start || !el || !parent) return
          setPosition({ x: Math.max(0, Math.min(parent.clientWidth - el.offsetWidth, start.startX + event.clientX - start.x)), y: Math.max(0, Math.min(parent.clientHeight - el.offsetHeight, start.startY + event.clientY - start.y)) })
        }}
        onPointerUp={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}>
        <Icon name="settings" size={14}/><strong>{title}</strong>
        <button data-test="toggle-inspector-dock" title={mode === 'floating' ? 'Dock tool controls on the right' : 'Float tool controls beside Objects'} aria-label={mode === 'floating' ? 'Dock tool controls' : 'Float tool controls'} onClick={() => useShell.getState().setInspectorMode(mode === 'floating' ? 'docked' : 'floating')}><Icon name="splitView" size={14}/></button>
        <button data-test="hide-tool-inspector" aria-label="Hide tool controls" title="Hide controls; the current operation stays open" onClick={() => useShell.getState().setInspectorOpen(false)}>×</button>
      </div>
      <div className="inspector-body">{children}</div>
      {active && <div className="inspector-operation-hint">Use the tool’s confirm or cancel controls to finish.</div>}
    </section>
  </>
}
