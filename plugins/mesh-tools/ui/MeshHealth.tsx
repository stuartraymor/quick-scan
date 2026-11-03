// SPDX-License-Identifier: AGPL-3.0-only
// Edit Scan opens, as QUICKSURFACE's does, on what is wrong with the mesh:
// its separate meshes, holes, open boundaries and edges shared by more than
// two triangles, and duplicate triangles — each with the tool that mends it. The counts are
// mesh.inspect's, read again whenever the mesh changes.

import { useEffect, useState } from 'react'
import { runCommand } from '../../../src/commands/registry'
import { useStore } from '../../../src/state/store'
import { useMeshTools } from '../state/meshStore'
import { meshHotkeys } from '../app/meshHotkeys'

type Health = { meshes: number; holes: number; boundaries: number; nonManifold: number | null; duplicates?: number | null }

/** The four counts out of mesh.inspect's answer. */
export function healthOf(inspect: unknown): Health | null {
  const r = inspect as { islands?: { pieces?: number }; holes?: { holes?: number; rims?: number }; bad?: number; duplicates?: number } | null
  if (!r?.islands || !r.holes) return null
  return {
    meshes: r.islands.pieces ?? 0,
    holes: r.holes.holes ?? 0,
    boundaries: r.holes.rims ?? 0,
    nonManifold: r.bad ?? null,
    duplicates: r.duplicates ?? null,
  }
}

export function MeshHealthView({ health, busy, onTool, onRemoveDuplicates }: { health: Health | null; busy: boolean; onTool: (tool: 'islands' | 'holes' | 'trim') => void; onRemoveDuplicates?: () => void }) {
  const row = (label: string, value: number | null | undefined, action: string, tool: 'islands' | 'holes' | 'trim' | null, warn: boolean, test: string) => (
    <div className="kv mesh-health-row" data-test={`mesh-health-${test}`}>
      <span className="name">{label}</span>
      <b className={warn ? 'mesh-health-warn' : undefined}>{value ?? '—'}</b>
      {tool && <button disabled={busy || !value} onClick={() => onTool(tool)}>{action}</button>}
    </div>
  )
  return (
    <div className="group" data-test="mesh-health">
      <div className="sec-head">Mesh quality</div>
      {row('Individual meshes', health?.meshes, 'Edit …', 'islands', (health?.meshes ?? 1) > 1, 'meshes')}
      {row('Holes', health?.holes, 'Edit …', 'holes', (health?.holes ?? 0) > 0, 'holes')}
      {row('Boundaries', health?.boundaries, 'Edit …', 'holes', false, 'boundaries')}
      <div className="kv mesh-health-row" data-test="mesh-health-duplicates">
        <span className="name">Duplicate triangles</span>
        <b className={(health?.duplicates ?? 0) > 0 ? 'mesh-health-warn' : undefined}>{health?.duplicates ?? '—'}</b>
        <button data-test="mesh-remove-duplicates" disabled={busy || !health?.duplicates || !onRemoveDuplicates} onClick={onRemoveDuplicates}>Remove</button>
      </div>
      {row('Edges on 3+ triangles', health?.nonManifold, '', null, (health?.nonManifold ?? 0) > 0, 'nonmanifold')}
      {!health && <p className="hint">Reading the mesh…</p>}
    </div>
  )
}

export function MeshHealth({ busy }: { busy: boolean }) {
  const triangles = useStore((s) => s.triangleCount)
  const edits = useMeshTools((s) => s.edits.length)
  const [health, setHealth] = useState<Health | null>(null)
  useEffect(() => {
    if (!triangles || busy) return
    let live = true
    runCommand('mesh.inspect', {}).then((r) => { if (live) setHealth(healthOf(r)) }, () => { if (live) setHealth(null) })
    return () => { live = false }
  }, [triangles, edits, busy])
  return <MeshHealthView health={health} busy={busy} onTool={(t) => useMeshTools.getState().setTool(t)} onRemoveDuplicates={() => meshHotkeys.removeDuplicates?.()} />
}
