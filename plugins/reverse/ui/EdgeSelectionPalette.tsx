// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from 'react'
import { useLength } from '../../../src/app/useUnits'
import { createPortal } from 'react-dom'
import type { EdgeInfo } from '../core/buildTypes'
import { edgeSelectionOptions, type EdgeSelectionOption } from '../core/edgeSelectionOptions'
import { splitEdges, tangentChain } from '../core/topo'
import { useReverse } from '../state/reStore'
import type { BodyPicks, BodyTopology } from '../viewer/bodyPicks'
import './edgeSelectionPalette.css'

export interface PickedEdgeOptions {
  x: number; y: number; bodyId: number; seed: EdgeInfo; picks: BodyPicks
  topology: BodyTopology; options: ReturnType<typeof edgeSelectionOptions>
}

export function EdgeSelectionPalette({ pick, close }: { pick: PickedEdgeOptions; close: () => void }) {
  const length = useLength()
  const draft = useReverse(s => s.featureDraft)
  const box = useRef<HTMLDivElement>(null)
  const { picks, bodyId, topology, seed } = pick
  const edgeDraft = draft && (draft.kind === 'chamfer' || (draft.kind === 'fillet' && draft.mode !== 'faceRound')) && draft.body === bodyId ? draft : null
  const variable = edgeDraft?.kind === 'fillet' && edgeDraft.mode === 'variable'
  const selected = edgeDraft && (variable && edgeDraft.kind === 'fillet' ? edgeDraft.variable?.some(v => v.edge.hash === seed.hash) : edgeDraft.edges.some(e => e.hash === seed.hash))
  useEffect(() => {
    if (!selected) { close(); return }
    const outside = (e: Event) => { if (!box.current?.contains(e.target as Node)) close() }
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close() }
    }
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('wheel', outside, true)
    window.addEventListener('keydown', escape, true)
    window.addEventListener('resize', close)
    return () => {
      picks.setSuggestedEdges([])
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('wheel', outside, true)
      window.removeEventListener('keydown', escape, true)
      window.removeEventListener('resize', close)
    }
  }, [pick, picks, selected, close])
  if (!selected || !edgeDraft) return null

  const choose = (option: EdgeSelectionOption) => {
    // Preserve prior picks, including edges previously implied by the
    // global tangent option. This choice applies only to the latest pick.
    const prior = edgeDraft.edges.filter(e => variable || e.hash !== seed.hash)
    const ids = new Set(edgeDraft.chain ? tangentChain(topology.edges, prior.map(e => e.hash), splitEdges(topology)) : prior.map(e => e.hash))
    const rows = edgeDraft.kind === 'fillet' ? edgeDraft.variable ?? [] : []
    const variableRows = rows.filter(v => !variable || v.edge.hash !== seed.hash).map(v =>
      v.chain === undefined && v.points?.length ? { ...v, chain: edgeDraft.chain } : v)
    if (variable) {
      const source = rows.find(v => v.edge.hash === seed.hash)!
      const group = option.kind === 'tangent' ? [seed] : option.edges
      for (const edge of group) {
        if (ids.has(edge.hash) || variableRows.some(v => v.edge.hash === edge.hash)) continue
        variableRows.push({ ...source, edge, chain: option.kind === 'tangent' })
      }
    } else for (const e of option.edges) if (!variableRows.some(v => v.edge.hash === e.hash)) ids.add(e.hash)
    const edges = [...prior, ...topology.edges.filter(e => ids.has(e.hash) && !prior.some(p => p.hash === e.hash))]
    useReverse.getState().setFeatureDraft({ edges, chain: false, ...(edgeDraft.kind === 'fillet' ? { variable: variableRows } : {}) })
    close()
  }
  const highlight = (option: EdgeSelectionOption) => picks.setSuggestedEdges(option.edges.map(e => ({ bodyId, hash: e.hash })))
  const height = 12 + pick.options.length * 31
  return createPortal(<div ref={box} className="edge-selection-palette" data-test="edge-selection-options" role="group" aria-label="Edge selection options"
    style={{ left: Math.max(4, Math.min(pick.x + 14, window.innerWidth - 200)), top: Math.max(4, Math.min(pick.y + 12, window.innerHeight - height)) }}
    onMouseLeave={() => picks.setSuggestedEdges([])} onBlur={() => picks.setSuggestedEdges([])}>
    {pick.options.map((option,i) => <button key={i} type="button" data-test={'edge-choice-' + option.kind} onMouseEnter={() => highlight(option)}
      onFocus={() => highlight(option)} onClick={() => choose(option)}>
      <span>{option.label}</span><small>{option.edges.length === 1 ? length.fmt(option.edges[0].fingerprint.length, 2) : option.edges.length + ' edges'}</small>
    </button>)}
  </div>, document.body)
}
