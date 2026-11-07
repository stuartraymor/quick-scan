// SPDX-License-Identifier: AGPL-3.0-only
// project.save and project.load headless: the session saved, opened again
// from the bytes, and saved once more comes out the same — the test the
// 2026-11-07 audit found missing (T-02) when a save-target bug (D-01)
// shipped undetected.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { refused, run, startHeadless, stlBytes, type Headless } from './commandKit'
import { boxMesh } from './helpers'
import { unpackProject } from '../src/core/project/archive'
import { useStore } from '../src/state/store'
import { useDocument } from '../src/state/documentStore'

vi.setConfig({ testTimeout: 60_000 })
const BOX = stlBytes(boxMesh(40, 40))
type Fit = { kind: string; fit: { point?: number[]; normal?: number[]; [k: string]: unknown } }
type Saved = { file: { name: string; bytes: Uint8Array; mimeType: string }; holds: Record<string, number>; aligned: boolean }

describe('project.save and project.load headless', () => {
  let h: Headless
  beforeEach(async () => { h = await startHeadless() })
  afterEach(() => h.stop())

  it('refuses to save an empty session', async () => {
    expect((await refused('project.save')).code).toBe('failed')
  })

  it('saves, reopens from the bytes and saves again to the same project', async () => {
    await run('scan.open', { bytes: BOX, name: 'box.stl', discard: true })
    const fitted = await run<{ element: Fit }>('element.fit', { kind: 'plane', at: { point: [0, 0, 20] } })
    const first = await run<Saved>('project.save')
    expect(first.file.name).toBe('box.scanruler')
    expect(first.file.mimeType).toBe('application/zip')
    expect(first.holds).toEqual({ elements: 1 })
    expect(first.aligned).toBe(false)
    const a = unpackProject(first.file.bytes)
    expect(a.manifest.scan?.fileName).toBe('box.stl')
    expect([...a.members.keys()]).toContain(a.manifest.scan!.member)

    // Without discard the load refuses while the session holds work.
    expect((await refused('project.load', { bytes: first.file.bytes, name: 'box.scanruler' })).code).toBe('invalid_state')
    const state = await run<{ elements: Fit[] }>('project.load', { bytes: first.file.bytes, name: 'box.scanruler', discard: true })
    expect(state.elements).toHaveLength(1)
    expect(state.elements[0].fit.normal).toEqual(fitted.element.fit.normal)
    expect(state.elements[0].fit.point).toEqual(fitted.element.fit.point)
    expect(useStore.getState().statusText).toMatch(/^Project opened — box.scanruler/)
    expect(useDocument.getState().origin).toBe('project')

    const second = await run<Saved>('project.save')
    const b = unpackProject(second.file.bytes)
    // The manifest as saved again: the same work, the same scan member.
    const stable = (m: Record<string, unknown>) => { const { savedAt: _s, ...rest } = m as Record<string, unknown> & { savedAt?: unknown }; return rest }
    expect(stable(b.manifest as unknown as Record<string, unknown>)).toEqual(stable(a.manifest as unknown as Record<string, unknown>))
    expect(b.members.get(b.manifest.scan!.member)).toEqual(a.members.get(a.manifest.scan!.member))
  })

  it('a scan opened after a project is a new document', async () => {
    await run('scan.open', { bytes: BOX, name: 'box.stl', discard: true })
    await run('element.fit', { kind: 'plane', at: { point: [0, 0, 20] } })
    const saved = await run<Saved>('project.save')
    await run('project.load', { bytes: saved.file.bytes, name: 'box.scanruler', discard: true })
    expect(useDocument.getState().origin).toBe('project')
    await run('scan.open', { bytes: BOX, name: 'other.stl', discard: true })
    expect(useDocument.getState().origin).toBe('scan')
    expect(useDocument.getState().file).toBeNull()
    expect(useDocument.getState().token).toBeNull()
  })
})
