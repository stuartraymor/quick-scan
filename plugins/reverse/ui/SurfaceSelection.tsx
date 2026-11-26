// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { brushRange, useMark, WAND_MIN_DEG, WAND_MAX_DEG } from '../../../src/state/markStore'
import { useShell } from '../../../src/state/shellStore'
import { ExtractSelection, WandDegreesField } from '../../../src/ui/ExtractPrimitives'
import { ExtractIcon } from '../../../src/ui/ExtractIcon'
import { reverseSession } from '../app/reSession'
import { createPortal } from 'react-dom'
import { extractQuickPlacement } from '../../../src/ui/extractQuickPlacement'
import { BrushNumber, BrushSlider } from '../../../src/ui/MarkTools'
import { ctrlWheelStep } from '../../../src/ui/ExtractHints'
import { useStore } from '../../../src/state/store'
import { useLength } from '../../../src/app/useUnits'
import { useRePrefs } from '../state/rePrefs'
import type { SurfaceShape } from '../core/features'
import { useReverse } from '../state/reStore'

export function SurfaceSelection({ region, shape, choose }: { region: Uint32Array; shape: SurfaceShape | null; choose: (shape: SurfaceShape) => void }) {
  useEffect(() => {
    const previous = useMark.getState().gesture
    useMark.getState().setGesture('wand')
    return () => useMark.getState().setGesture(previous)
  }, [])
  const mark = useMark()
  const modelSize = useStore(s => s.modelSize)
  const units = useLength()
  const range = brushRange(modelSize)
  const analysis = useRePrefs(s => s.surfaceMap)
  const newFit = useReverse(s => s.featureDraft?.kind === 'surface' && s.featureDraft.featureId === undefined)
  const fitted = useReverse(s => s.preview.status === 'ok' && !!s.preview.surface)
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  const [position, setPosition] = useState<ReturnType<typeof extractQuickPlacement> | null>(null)
  const toolbar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let pointer: number | null = null
    let onMesh = false
    let picked = false
    let wheelEnd: number | undefined
    const adjusting = (value: boolean) => {
      const state = useReverse.getState(), d = state.featureDraft
      if (d?.kind === 'surface' && Boolean(d.adjustingRegion) !== value) state.setFeatureDraft({ adjustingRegion: value })
    }
    const down = (event: PointerEvent) => {
      const target = event.target as Element
      const mesh = target.matches('.viewport canvas')
      if (mesh) setAnchor(null)
      const sensitivity = target.matches('[data-test="extract-degrees-slider"], [data-test="surface-quick-degrees"]')
      if ((!mesh || !useMark.getState().gesture || event.shiftKey || event.ctrlKey || event.metaKey) && !sensitivity) return
      if (pointer !== null || (event.button !== 0 && event.button !== 2)) return
      pointer = event.pointerId
      picked = false
      onMesh = mesh
      adjusting(true)
    }
    const end = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return
      pointer = null
      adjusting(false)
      if (onMesh && event.type === 'pointerup' && (useMark.getState().gesture !== 'wand' || picked)) setAnchor({ x: event.clientX, y: event.clientY })
    }
    const interrupt = () => { pointer = null; adjusting(false) }
    const wandPick = () => { picked = true }
    const isAngle = (target: EventTarget | null) => target instanceof Element && target.matches('[data-test="extract-degrees"], [data-test="surface-quick-angle"]')
    const focus = (event: FocusEvent) => { if (isAngle(event.target)) adjusting(true) }
    const blur = (event: FocusEvent) => { if (isAngle(event.target)) adjusting(false) }
    const wheel = (event: WheelEvent) => {
      if (!(event.target as Element).matches('.viewport canvas')) return
      if (event.ctrlKey && ['wand','brush'].includes(useMark.getState().gesture ?? '')) {
        event.preventDefault()
        event.stopPropagation()
        if (useMark.getState().gesture === 'wand') {
          adjusting(true)
          window.clearTimeout(wheelEnd)
          wheelEnd = window.setTimeout(() => { if (pointer === null) adjusting(false) }, 140)
        }
        ctrlWheelStep(event.deltaY)
      } else setAnchor(null)
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    window.addEventListener('blur', interrupt)
    window.addEventListener('scanruler:wand-pick', wandPick)
    window.addEventListener('focusin', focus)
    window.addEventListener('focusout', blur)
    window.addEventListener('wheel', wheel, { capture: true, passive: false })
    return () => {
      window.clearTimeout(wheelEnd)
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      window.removeEventListener('blur', interrupt)
      window.removeEventListener('scanruler:wand-pick', wandPick)
      window.removeEventListener('focusin', focus)
      window.removeEventListener('focusout', blur)
      window.removeEventListener('wheel', wheel, true)
    }
  }, [])
  const showQuick = Boolean(anchor && region.length && mark.quickTools && mark.gesture)
  useLayoutEffect(() => {
    const viewport = document.querySelector('.viewport'), panel = document.querySelector('[data-test="tool-inspector"]')
    if (!showQuick || !anchor || !viewport) return
    const place = () => setPosition(extractQuickPlacement(anchor, viewport.getBoundingClientRect(), panel?.getBoundingClientRect(),
      { width: 221, height: toolbar.current?.offsetHeight || 98 }))
    place()
    const observer = new ResizeObserver(place)
    observer.observe(viewport)
    if (panel) observer.observe(panel)
    if (toolbar.current) observer.observe(toolbar.current)
    window.addEventListener('resize', place)
    return () => { observer.disconnect(); window.removeEventListener('resize', place) }
  }, [anchor, showQuick, mark.gesture])
  const types = (quick: boolean) => (['plane', 'cylinder', 'cone', 'sphere', 'freeform'] as const).map(kind =>
    <button key={kind} type="button" data-test={(quick ? 'surface-quick-' : 'surface-type-') + kind}
      title={'Fit ' + kind} aria-label={kind} aria-pressed={shape === kind} className={shape === kind ? 'on' : undefined}
      onClick={() => choose(kind)}><ExtractIcon name={kind} size={quick ? 20 : 26} /></button>)
  const brush = (quick: boolean) => <label className="surface-quick-field">Brush
    <BrushSlider diameter={mark.diameter} setDiameter={mark.setDiameter} brush={range} />
    <BrushNumber diameter={mark.diameter} setDiameter={mark.setDiameter} testId={quick ? 'surface-quick-size' : 'surface-brush-size'} />
    {units.units}
  </label>
  const scene = () => reverseSession()?.sceneRef.current
  const clear = () => {
    scene()?.clearPaint()
    useMark.getState().setCount(0)
    useReverse.getState().setRegion(new Uint32Array())
  }
  const hide = (which: 'selected' | 'unselected') => {
    const hidden = scene()?.hideTriangles(which)
    if (hidden) { clear(); useShell.getState().setHiddenTriangles(hidden) }
  }
  return <div className="qs-dialog extract-dialog surface-selection" data-test="surface-selection">
    <p className="qs-step">1. Select the area that you want to fit a surface</p>
    <ExtractSelection count={region.length} onClear={clear} onHide={() => hide('selected')} onIsolate={() => hide('unselected')}
      onShowAll={() => { scene()?.showHiddenTriangles(); useShell.getState().setHiddenTriangles(0) }} />
    {mark.gesture === 'brush' && brush(false)}
    <label className="checkrow"><input type="checkbox" data-test="surface-quick-tools" checked={mark.quickTools}
      onChange={e => mark.setQuickTools(e.target.checked)} />Show quick tools</label>
    <hr />
    <p className="qs-step">2. Select the type of surface</p>
    <div className="qs-typerow" data-test="surface-shape" role="toolbar" aria-label="Surface type">
      {types(false)}
    </div>
    {showQuick && createPortal(<div ref={toolbar} role="toolbar" aria-label="Surface quick tools" data-test="surface-quick"
      className="qs-quick surface-quick" style={{ ...position, visibility: position ? 'visible' : 'hidden' }}>
      <div className="qs-quick-types">{types(true)}</div>
      {mark.gesture === 'wand' && <div className="surface-quick-field">
        <input type="range" aria-label="Wand sensitivity" data-test="surface-quick-degrees" min={WAND_MIN_DEG} max={WAND_MAX_DEG}
          step="0.01" value={mark.wandDegrees} disabled={mark.wandConnected} onChange={e => mark.setWandDegrees(Number(e.target.value))} />
        <WandDegreesField testId="surface-quick-angle" />°
      </div>}
      {mark.gesture === 'brush' && brush(true)}
      <label><input type="checkbox" data-test="surface-quick-analysis" checked={!!shape && fitted && analysis} disabled={!shape || !fitted}
        onChange={e => useRePrefs.getState().setSurfaceMap(e.target.checked)} /> Analyze</label>
      {newFit && fitted && <button type="button" data-test="surface-quick-create-stay"
        onClick={() => useReverse.getState().commitFeature('nextSurface')}>Create &amp; Stay</button>}
    </div>, document.body)}
  </div>
}
