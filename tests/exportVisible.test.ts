// SPDX-License-Identifier: AGPL-3.0-only
// Scan Data › Export Visible writes the scan as shown — hidden triangles left
// out — as an STL. Audit 2026-11-07 W-01: the key ran the elements STEP export.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { buildScanMesh, exportVisibleScan } from '../src/app/exports'
import { useStore } from '../src/state/store'
import type { SceneManager } from '../src/viewer/SceneManager'

// Two triangles side by side; the second is the one "hidden".
const square = () => {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3))
  g.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 2, 0, 2, 3]), 1))
  return g
}
const sceneOf = (geometry: THREE.BufferGeometry, shown = true) =>
  ({ scanGeometry: () => geometry, scanShown: () => shown }) as unknown as SceneManager

// Binary STL: 80-byte header, uint32 triangle count.
const stlTriangles = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true)

describe('Export Visible (W-01)', () => {
  const saved: { name: string; blob: Blob }[] = []
  beforeEach(() => {
    saved.length = 0
    useStore.setState({ fileName: 'part.stl', projectName: null, appliedAlignment: null, statusText: '', errorText: null } as never)
    const blobs = new Map<string, Blob>()
    let n = 0
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL(b: Blob) { const id = `blob:${n++}`; blobs.set(id, b); return id }
      static revokeObjectURL() {}
    })
    vi.stubGlobal('document', {
      createElement: () => {
        const a = { href: '', download: '', style: {} as Record<string, string>, click: () => {}, remove: () => {} }
        a.click = () => saved.push({ name: a.download, blob: blobs.get(a.href)! })
        return a
      },
      body: { appendChild: () => {} },
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('writes an STL of the scan, not the elements STEP', async () => {
    await exportVisibleScan({ current: sceneOf(square()) })
    expect(useStore.getState().errorText).toBeNull()
    expect(saved).toHaveLength(1)
    expect(saved[0].name).toBe('part-export.stl')
    expect(saved[0].name.endsWith('.step')).toBe(false)
    expect(stlTriangles(new Uint8Array(await saved[0].blob.arrayBuffer()))).toBe(2)
  })

  it('leaves hidden triangles out', async () => {
    const g = square()
    g.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 2]), 1)) // as hideTriangles leaves it
    const file = buildScanMesh(sceneOf(g), 'stl')
    expect(file).not.toBeNull()
    expect(stlTriangles(file!.bytes)).toBe(1)
    await exportVisibleScan({ current: sceneOf(g) })
    expect(stlTriangles(new Uint8Array(await saved[0].blob.arrayBuffer()))).toBe(1)
  })

  it('saves nothing when the scan itself is hidden, and says so', async () => {
    await exportVisibleScan({ current: sceneOf(square(), false) })
    expect(saved).toHaveLength(0)
    expect(useStore.getState().statusText).toMatch(/scan is hidden/)
  })
})
