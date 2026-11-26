// SPDX-License-Identifier: AGPL-3.0-only
// What Auto Freeform borrows that has to be loaded before it can run: the
// mesh simplifier (meshoptimizer, WebAssembly), which makes the working copy
// of a dense scan small enough for a quick layout. The run itself stays
// synchronous; this is awaited once before it.

import type { WorkMesh } from './autoPrepare'

export interface AutoTools {
  /** The mesh at about `triangles` triangles, its open rims kept where they are. */
  simplify(mesh: WorkMesh, triangles: number): WorkMesh
}

let loading: Promise<AutoTools> | null = null

export function loadAutoTools(): Promise<AutoTools> {
  loading ??= import('meshoptimizer/simplifier').then(async ({ MeshoptSimplifier }) => {
    await MeshoptSimplifier.ready
    return {
      simplify(mesh, triangles) {
        const target = Math.max(3, Math.floor(triangles) * 3)
        if (mesh.indices.length <= target) return mesh
        const [indices] = MeshoptSimplifier.simplify(mesh.indices, mesh.positions, 3, target, 0.02, ['LockBorder'])
        if (indices.length < 3 || indices.length >= mesh.indices.length) return mesh
        // The vertices still in use, renumbered.
        const remap = new Int32Array(mesh.positions.length / 3).fill(-1)
        const out = new Uint32Array(indices.length)
        const pos: number[] = []
        for (let i = 0; i < indices.length; i++) {
          const v = indices[i]
          let w = remap[v]
          if (w < 0) {
            w = pos.length / 3
            remap[v] = w
            pos.push(mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2])
          }
          out[i] = w
        }
        return { positions: Float32Array.from(pos), indices: out }
      },
    }
  })
  return loading
}
