// SPDX-License-Identifier: AGPL-3.0-only
// Scan Data → Mirror: reflect the scan in one of the world planes through the
// origin, picked from three tiles as in QUICKSURFACE.

import { useState } from 'react'

export type MirrorPlane = 'OXY' | 'OYZ' | 'OXZ'

/** The scale factors that reflect in each plane. */
export const MIRROR_FACTORS: Record<MirrorPlane, [number, number, number]> = {
  OXY: [1, 1, -1],
  OYZ: [-1, 1, 1],
  OXZ: [1, -1, 1],
}

interface Props {
  onApply: (plane: MirrorPlane) => void
  onClose: () => void
}

export function MirrorDialog({ onApply, onClose }: Props) {
  const [plane, setPlane] = useState<MirrorPlane>('OXY')
  return (
    <div className="modalback" data-test="mirror-dialog" onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
      <form className="modal" style={{ width: 260, display: 'grid', gap: 10, padding: 14 }}
        onSubmit={(e) => { e.preventDefault(); onApply(plane); onClose() }}>
        <header style={{ fontWeight: 600 }}>Mirror</header>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {(Object.keys(MIRROR_FACTORS) as MirrorPlane[]).map((p) => (
            <button key={p} type="button" aria-pressed={plane === p} data-test={`mirror-${p}`} onClick={() => setPlane(p)}
              style={{ padding: '10px 0', outline: plane === p ? '2px solid var(--accent)' : undefined }}>{p}</button>
          ))}
        </div>
        <small style={{ color: 'var(--dim)' }}>Reflects the scan in the world plane through the origin.</small>
        <footer style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="submit">OK</button>
          <button type="button" onClick={onClose}>Cancel</button>
        </footer>
      </form>
    </div>
  )
}
