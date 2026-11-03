// SPDX-License-Identifier: AGPL-3.0-only
import type { SketchChains } from '../app/useReverseWorkspace'
import { useSketchBrush } from '../state/sketchBrushStore'

/** Controls follow the observed Fit primitives panel. Geometry is fitted
 *  independently to highlighted section samples, with actual tolerance checks. */
export function SketchExtractPanel({ chainsOf }: { chainsOf: () => SketchChains | null }) {
  const s = useSketchBrush()
  if (!s.open) return null
  const supported = (id: 'line' | 'arc' | 'circle' | 'curve' | 'rectangle' | 'slot' | 'hexagon', label: string) => <button type="button" data-test={`sketch-fit-${id}`} aria-pressed={s.primitive === id} className={s.primitive === id ? 'on' : undefined} onClick={() => s.setPrimitive(id)}>{label}</button>
  return <div className="sketch-extract-panel" data-test="sketch-extract-panel" style={{ display: 'grid', gap: 8 }}>
    <label className="checkrow"><input type="checkbox" data-test="sketch-fit-instant" checked={s.instant} onChange={(e) => s.setInstant(e.target.checked)} />Instant Fit (hold Shift to disable temporarily)</label>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 3 }}>
      {supported('line', 'Fit Line')}{supported('arc', 'Fit Arc')}{supported('circle', 'Fit Circle')}
      {supported('rectangle', 'Rectangle')}{supported('slot', 'Slot')}{supported('hexagon', 'Hexagon')}
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 48px 1fr', gap: 4, alignItems: 'center' }}>
      {supported('curve', 'Fit Curve')}<label htmlFor="sketch-fit-curve-points">Points</label><input id="sketch-fit-curve-points" type="number" min={4} max={64} value={s.curvePoints} disabled={s.primitive !== 'curve'} onChange={(e) => s.setCurvePoints(Number(e.target.value))} />
      <button type="button" data-test="sketch-fit-apply" disabled={!s.selected.length || !s.preview?.ok} onClick={() => s.apply()}>Apply</button>
    </div>
    <label className="field"><span>Target tolerance</span><input type="number" data-test="sketch-fit-tolerance" disabled={s.primitive !== 'curve'} title="Used by Fit Curve" min={0.0001} step={0.01} value={s.tolerance} onChange={(e) => s.setTolerance(Number(e.target.value))} /><span>mm</span></label>
    <hr />
    <label className="field" style={{ flexWrap: 'wrap' }}><span>Make line horizontal/vertical if less than</span><input aria-label="Horizontal/vertical threshold" type="number" min={0} max={45} step={0.1} value={s.axisDegrees} onChange={(e) => s.setAxisDegrees(Number(e.target.value))} /><span>degrees</span></label>
    <hr />
    <label className="checkrow" title="Automatic joins between separately fitted primitives are not available in this review build."><input type="checkbox" disabled checked={false} readOnly />Instant join</label>
    <label className="field"><span>Minimum fillet radius</span><input type="number" disabled value={1} readOnly /><span>mm</span></label>
    <hr />
    <label htmlFor="sketch-fit-brush-size">Brush size (Ctrl + Mouse Wheel)</label>
    <input id="sketch-fit-brush-size" data-test="sketch-fit-brush-size" type="range" min={8} max={200} value={s.brushPx} onChange={(e) => s.setBrushPx(Number(e.target.value))} />
    <p className="hint" data-test="sketch-fit-feedback" role="status" style={{ margin: 0 }}>{s.message ?? (s.preview && !s.preview.ok ? s.preview.error : s.selected.length ? `${s.selected.length} points highlighted${s.preview?.ok ? ` · maximum deviation ${s.preview.maxDeviation.toFixed(3)} mm` : ''}` : chainsOf()?.chains.length ? 'Paint section points to fit the chosen primitive.' : 'No section points on this sketch plane. Move the plane through the scan first.')}</p>
    <div style={{ display: 'flex', justifyContent: 'space-between' }}><button type="button" data-test="sketch-fit-clear" disabled={!s.selected.length} onClick={() => s.clear()}>Clear selection</button><button type="button" data-test="sketch-fit-back" onClick={() => s.setOpen(false)}>Back</button></div>
  </div>
}
