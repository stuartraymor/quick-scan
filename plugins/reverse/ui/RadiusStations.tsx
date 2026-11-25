// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react'
import type { RadiusPoint } from '../core/roundInputs'
import { useUnits } from '../../../src/app/useUnits'
import { snapFinishingSize } from '../state/finishingInput'
import { Num } from './featureFields'

export function RadiusStations({ edgeIndex, ends, points, onChange }: {
  edgeIndex: number; ends: [number, number]; points: RadiusPoint[]
  onChange: (points: RadiusPoint[], ends: [number, number]) => void
}) {
  const units = useUnits()
  const [chosen, select] = useState(0)
  const all = [{ position: 0, radius: ends[0] }, ...points, { position: 1, radius: ends[1] }]
  const index = Math.min(chosen, all.length - 1)
  const current = all[index]
  const interior = index > 0 && index < all.length - 1
  const prefix = `fillet-station-${edgeIndex}`
  const set = (values: RadiusPoint[]) => onChange(values.slice(1, -1), [values[0].radius, values[values.length - 1].radius])
  const update = (patch: Partial<RadiusPoint>) => set(all.map((v, i) => i === index ? { ...v, ...patch } : v))
  return <div>
    <label className="field"><span>Control point</span>
      <select data-test={prefix} value={index} onChange={e => select(Number(e.target.value))}>
        {all.map((p, i) => <option key={i} value={i}>P{i + 1} · {+(100 * p.position).toFixed(4)}%</option>)}
      </select></label>
    <button type="button" data-test={`${prefix}-add`} onClick={() => {
      const i = Math.min(index, all.length - 2), a = all[i], b = all[i + 1]
      set([...all.slice(0, i + 1), { position: (a.position + b.position) / 2, radius: snapFinishingSize((a.radius + b.radius) / 2, units) }, ...all.slice(i + 1)])
      select(i + 1)
    }}>Insert midpoint</button>
    <button type="button" disabled={!interior} onClick={() => { set(all.filter((_, i) => i !== index)); select(index - 1) }}>Delete point</button>
    {interior && <Num key={`position-${index}`} label="Position" unit="%" testId={`${prefix}-position`}
      value={current.position * 100} onCommit={v => {
        if (v > all[index - 1].position * 100 && v < all[index + 1].position * 100) update({ position: v / 100 })
      }} />}
    <Num finishingLength key={`radius-${index}`} label="Point radius" nominal="radius" testId={`${prefix}-radius`}
      value={current.radius} onCommit={v => update({ radius: Math.abs(v) })} />
    <button type="button" onClick={() => set(all.map(p => ({ ...p, radius: current.radius })))}>Set radius to all</button>
  </div>
}
