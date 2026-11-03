// SPDX-License-Identifier: AGPL-3.0-only
// Edit Scan → Clipping Box…, as QUICKSURFACE 8.0.128 shows it (recorded
// live): a box round the scan with a handle on each face to drag its size,
// the scan drawn only inside it, and Reset, Create new object, Delete
// non-visible, Accept and Cancel. Accept hides what lies outside (Show all
// hidden brings it back); Delete non-visible deletes it, one undo step.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { meshHotkeys, type ClipBox } from '../app/meshHotkeys'

const AXIS_COLOUR = ['#e0393e', '#3bb44a', '#2b6fe0']

/** The six face handles: axis, which end, and the face's middle. */
export function boxHandles(b: ClipBox): { axis: 0 | 1 | 2; end: 'min' | 'max'; at: [number, number, number] }[] {
  const mid: [number, number, number] = [0, 1, 2].map((i) => (b.min[i] + b.max[i]) / 2) as [number, number, number]
  return ([0, 1, 2] as const).flatMap((axis) => (['min', 'max'] as const).map((end) => {
    const at: [number, number, number] = [...mid]
    at[axis] = b[end][axis]
    return { axis, end, at }
  }))
}

/** A face dragged `mm` along its axis, held at least `gap` from the other. */
export function dragFace(b: ClipBox, axis: 0 | 1 | 2, end: 'min' | 'max', mm: number, gap = 1e-3): ClipBox {
  const next: ClipBox = { min: [...b.min], max: [...b.max] }
  if (end === 'min') next.min[axis] = Math.min(b.min[axis] + mm, b.max[axis] - gap)
  else next.max[axis] = Math.max(b.max[axis] + mm, b.min[axis] + gap)
  return next
}

export function ClippingBox({ onClose }: { onClose: () => void }) {
  const [box, setBox] = useState<ClipBox | null>(() => meshHotkeys.clip?.bounds() ?? null)
  const start = useRef<ClipBox | null>(box)
  const [, redraw] = useState(0)
  const drag = useRef<{ axis: 0 | 1 | 2; end: 'min' | 'max'; x: number; y: number; from: ClipBox; dir: [number, number]; perMm: number } | null>(null)

  useEffect(() => { meshHotkeys.clip?.set(box) }, [box])
  useEffect(() => () => meshHotkeys.clip?.set(null), [])
  // The handles follow the view as it turns.
  useEffect(() => {
    let id = 0
    const tick = () => { redraw((n) => n + 1); id = requestAnimationFrame(tick) }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [])
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const along = ((e.clientX - d.x) * d.dir[0] + (e.clientY - d.y) * d.dir[1]) / d.perMm
      setBox(dragFace(d.from, d.axis, d.end, along))
    }
    const up = () => { drag.current = null }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
    return () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up) }
  }, [])

  if (!box) return null
  const screen = meshHotkeys.clip?.screen
  const handles = boxHandles(box).map((h) => ({ ...h, s: screen?.(h.at) ?? null }))
  const grab = (h: (typeof handles)[number], e: React.PointerEvent) => {
    if (!h.s || !screen) return
    const one: [number, number, number] = [...h.at]
    one[h.axis] += 1
    const s1 = screen(one)
    if (!s1) return
    const dx = s1.x - h.s.x, dy = s1.y - h.s.y
    const perMm = Math.hypot(dx, dy)
    if (perMm < 1e-6) return
    e.preventDefault()
    e.stopPropagation()
    drag.current = { axis: h.axis, end: h.end, x: e.clientX, y: e.clientY, from: box, dir: [dx / perMm, dy / perMm], perMm }
  }
  const close = () => { meshHotkeys.clip?.set(null); onClose() }
  return (
    <>
      {createPortal(
        handles.map((h) => h.s && (
          <div key={`${h.axis}${h.end}`} data-test={`clip-handle-${'xyz'[h.axis]}-${h.end}`} onPointerDown={(e) => grab(h, e)}
            style={{ position: 'fixed', left: h.s.x - 7, top: h.s.y - 7, width: 14, height: 14, borderRadius: 7, background: AXIS_COLOUR[h.axis], border: '2px solid #fff', cursor: 'grab', zIndex: 950 }} />
        )),
        document.body,
      )}
      <div className="group" data-test="clipping-box">
        <div className="sec-head">Clipping Box</div>
        <p className="hint">Use the point handles on the screen to change the size of the box</p>
        <div className="toolrow"><button data-test="clip-reset" onClick={() => setBox(start.current)}>Reset</button></div>
        <div className="toolrow">
          <button data-test="clip-new-object" disabled title="Create new object needs more than one mesh in a project, which Quick Scan does not hold yet">Create new object</button>
          <button data-test="clip-delete" onClick={() => { meshHotkeys.clip?.deleteOutside(box); close() }}>Delete non-visible</button>
        </div>
        <div className="toolrow">
          <button className="primary" data-test="clip-accept" onClick={() => { meshHotkeys.clip?.hideOutside(box); close() }}>Accept</button>
          <button data-test="clip-cancel" onClick={close}>Cancel</button>
        </div>
      </div>
    </>
  )
}
