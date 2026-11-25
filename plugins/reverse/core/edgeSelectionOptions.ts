// SPDX-License-Identifier: AGPL-3.0-only
import type { EdgeInfo, FaceInfo } from './buildTypes'
import { splitEdges, tangentChain } from './topo'
import { len, sub } from '../../../src/core/vec'

export interface EdgeSelectionOption {
  kind: 'single' | 'tangent' | 'loop' | 'nearby'
  label: string
  edges: EdgeInfo[]
}

/** Walk only the wire containing the seed. A branch, gap or periodic seam
 * cannot turn an ambiguous boundary into a selectable closed loop. */
function loopOnFace(edges: EdgeInfo[], seed: EdgeInfo, face: number) {
  const boundary = edges.filter(e => e.faces.includes(face) && new Set(e.faces).size > 1)
  if (!boundary.some(e => e.hash === seed.hash)) return []
  const near = (a: typeof seed.ends[0], b: typeof a) => len(sub(a, b)) <= 1e-6
  const loop = [seed], seen = new Set([seed.hash])
  let tip = seed.ends[1]
  while (!near(tip, seed.ends[0])) {
    const next = boundary.filter(e => !seen.has(e.hash) && e.ends.some(p => near(p, tip)))
    if (next.length !== 1) return []
    const e = next[0]
    tip = near(e.ends[0], tip) ? e.ends[1] : e.ends[0]
    seen.add(e.hash)
    loop.push(e)
  }
  return loop
}

export function edgeSelectionOptions(topology: { faces: FaceInfo[]; edges: EdgeInfo[] }, seed: EdgeInfo, nearby: EdgeInfo[] = []) {
  const options: EdgeSelectionOption[] = []
  const seen = new Set<string>()
  function add(kind: EdgeSelectionOption['kind'], label: string, edges: EdgeInfo[]) {
    const key = edges.map(e => e.hash).sort((a,b) => a-b).join(',')
    if (!key || seen.has(key) || options.length === 5) return
    seen.add(key)
    options.push({ kind, label, edges })
  }
  add('single', 'Single edge', [seed])
  const byHash = new Map(topology.edges.map(e => [e.hash, e]))
  const hashes = tangentChain(topology.edges, [seed.hash], splitEdges(topology))
  add('tangent', 'Tangent chain', hashes.map(h => byHash.get(h)!))
  for (const [i,face] of [...new Set(seed.faces)].entries())
    add('loop', 'Face loop ' + (i + 1), loopOnFace(topology.edges, seed, face))
  for (const e of nearby.filter(e => e.hash !== seed.hash))
    add('nearby', 'Nearby ' + e.fingerprint.kind + ' edge', [e])
  return options
}
