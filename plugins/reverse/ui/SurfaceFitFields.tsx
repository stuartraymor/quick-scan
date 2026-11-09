// SPDX-License-Identifier: AGPL-3.0-only
// The fit controls of a freeform Fit Surface, in the order and words of
// QUICKSURFACE 8.0.128's edit dialog (read live, 2026-11-09): Method; U, the
// lock that ties V to it, and Auto…; Degree with Max degree; Expand by;
// Surface smoothness; Surface orientation; "Fit with the new parameters";
// Control Net. As there, a change waits for the button — the surface is not
// fitted again at every keystroke — and the button is dimmed until something
// has changed.

import { useEffect, useState } from 'react'
import type { SurfaceFitParams, SurfaceOrientation } from '../core/features'
import { MAX_DEGREE, NET_MAX, NET_MIN } from '../core/surfaceFit'
import { useControlNet } from '../state/controlNetStore'
import { type FeatureDraft, useReverse } from '../state/reStore'
import { Num } from './featureFields'

type SurfaceDraft = Extract<FeatureDraft, { kind: 'surface' }>

/** The orientations as QUICKSURFACE's list words them. */
export const ORIENTATIONS: { value: SurfaceOrientation; label: string }[] = [
  { value: 'bounds', label: 'Selection bounds' },
  { value: 'axis', label: 'Axis aligned' },
  { value: 'oxy', label: 'OXY' },
  { value: 'oyz', label: 'OYZ' },
  { value: 'oxz', label: 'OXZ' },
]

/** QUICKSURFACE's Auto… box opens on this target tolerance, mm. */
export const AUTO_TOLERANCE_MM = 0.1

/** A net size typed in: the number is taken when the box is left or Enter is pressed, not at every digit (typing 10 passes through 1). */
function NetBox({ testId, title, value, disabled, onCommit }: { testId: string; title: string; value: number; disabled?: boolean; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const take = () => {
    const n = Math.round(Number(text))
    if (!Number.isFinite(n) || n <= 0) return setText(String(value))
    const taken = Math.max(NET_MIN, Math.min(NET_MAX, n))
    setText(String(taken))
    if (taken !== value) onCommit(taken)
  }
  return (
    <input
      type="number"
      data-test={testId}
      title={title}
      min={NET_MIN}
      max={NET_MAX}
      style={{ width: 52 }}
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={take}
      onKeyDown={(e) => {
        if (e.key === 'Enter') take()
      }}
    />
  )
}

export function SurfaceFitFields({ d, set }: { d: SurfaceDraft; set: (patch: Partial<FeatureDraft>) => void }) {
  const preview = useReverse((s) => s.preview)
  const controlNetOn = useControlNet((s) => s.on)
  const [pending, setPending] = useState<SurfaceFitParams | null>(null)
  const [locked, setLocked] = useState(true)
  const [autoOpen, setAutoOpen] = useState(false)
  const [tolerance, setTolerance] = useState(AUTO_TOLERANCE_MM)
  // Another feature in the box starts from its own numbers.
  useEffect(() => {
    setPending(null)
    setAutoOpen(false)
  }, [d.featureId])

  const fit = pending ?? d.fit
  const edit = (patch: Partial<SurfaceFitParams>) => setPending({ ...fit, ...patch })
  const changed = pending !== null && JSON.stringify(pending) !== JSON.stringify(d.fit)
  const fitted = preview.status === 'ok' ? preview.surface?.net : undefined
  const net = fit.net ?? fitted ?? { u: 5, v: 5 }
  const degree = fit.maxDegree ? Math.max(1, Math.min(MAX_DEGREE, Math.min(net.u, net.v) - 1)) : Math.round(fit.degree)
  const setNet = (u: number, v: number) => edit({ net: { u: Math.max(NET_MIN, Math.min(NET_MAX, u)), v: Math.max(NET_MIN, Math.min(NET_MAX, v)) }, tolerance: undefined })
  const apply = (next: SurfaceFitParams) => {
    set({ fit: next })
    setPending(null)
  }

  return (
    <>
      <label className="field">
        <span>Method</span>
        {/* Picking a method, even the one already there, puts U and V back to 10, as QUICKSURFACE does. */}
        <select data-test="surface-method" value={fit.method ?? 'refined'} onChange={(e) => edit({ method: e.target.value as 'simple' | 'refined', net: { u: 10, v: 10 }, tolerance: undefined })}>
          <option value="simple">Simple</option>
          <option value="refined">Refined</option>
        </select>
      </label>
      <div className="netrow" style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '4px 0' }}>
        <span>U</span>
        <NetBox testId="surface-net-u" title="Control points across the region's long side, 3 to 20" value={net.u} onCommit={(u) => setNet(u, locked ? u : net.v)} />
        <button
          className="chip"
          data-test="surface-net-lock"
          aria-pressed={locked}
          title={locked ? 'V follows U — click to set them apart' : 'U and V are set apart — click to keep V equal to U'}
          onClick={() => {
            setLocked(!locked)
            if (!locked) setNet(net.u, net.u)
          }}
        >
          {locked ? '🔒' : '🔓'}
        </button>
        <span>V</span>
        <NetBox testId="surface-net-v" title="Control points across the short side, 3 to 20" value={net.v} disabled={locked} onCommit={(v) => setNet(net.u, v)} />
        <button data-test="surface-auto-open" title="Find the smallest net that fits within a target tolerance" onClick={() => setAutoOpen(true)}>
          Auto ...
        </button>
      </div>
      {autoOpen && (
        <div data-test="surface-auto-box" role="group" aria-label="Automatically find the best U and V">
          <span>Automatically find the best U and V</span>
          <Num label="Target tolerance" testId="surface-auto-tolerance" unit="mm" value={tolerance} onCommit={(v) => setTolerance(Math.max(0.001, Math.abs(v)))} hint="The smallest net whose worst point stands within this of the surface" />
          <span className="unitfield">
            <button
              data-test="surface-auto-ok"
              onClick={() => {
                setAutoOpen(false)
                apply({ ...fit, net: null, tolerance })
              }}
            >
              OK
            </button>
            <button data-test="surface-auto-cancel" onClick={() => setAutoOpen(false)}>
              Cancel
            </button>
          </span>
        </div>
      )}
      <div className="surface-degree-row" data-test="surface-degree-row">
        {fit.maxDegree ? (
          <label className="field">
            <span>Degree</span>
            <span className="unitfield"><input data-test="surface-degree" value={degree} disabled readOnly /></span>
          </label>
        ) : (
          <Num label="Degree" unit="" testId="surface-degree" value={degree} onCommit={(v) => edit({ degree: Math.max(1, Math.min(MAX_DEGREE, Math.round(Math.abs(v)))) })} />
        )}
        <label className="checkrow">
          <input type="checkbox" data-test="surface-max-degree" checked={fit.maxDegree === true} onChange={(e) => edit({ maxDegree: e.target.checked })} />
          <span>Max degree</span>
        </label>
      </div>
      <Num label="Expand by" unit="" testId="surface-expand" value={fit.expandPct} onCommit={(v) => edit({ expandPct: Math.min(200, Math.max(0, Math.abs(v))) })} hint="How far past the region the surface reaches, as a share of its extent — it has to meet its neighbours for the trim" />
      <Num label="Surface smoothness" unit="" testId="surface-smooth" value={fit.smoothness} onCommit={(v) => edit({ smoothness: Math.max(0, Math.abs(v)) })} hint="How hard the surface is held fair against the points: 0 follows them exactly, 0.01 fairs a scan's noise, more flattens detail" />
      <label className="field">
        <span>Surface orientation</span>
        <select data-test="surface-orientation" value={fit.orientation ?? 'bounds'} onChange={(e) => edit({ orientation: e.target.value as SurfaceOrientation })}>
          {ORIENTATIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <button className="block" data-test="surface-fit-apply" disabled={!changed} onClick={() => pending && apply(pending)}>
        Fit with the new parameters
      </button>
      <label className="checkrow" title="Draw the surface's control net over the part: its poles joined row by row and column by column. The surface is the B-spline of these poles.">
        <input type="checkbox" data-test="surface-control-net" checked={controlNetOn} onChange={(e) => useControlNet.getState().set(e.target.checked)} />
        <span>Control Net</span>
      </label>
    </>
  )
}
