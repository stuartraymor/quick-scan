// SPDX-License-Identifier: AGPL-3.0-only
// Which file Save writes to, through the desktop writer: only one this
// document was opened from or saved to. Regression for D-01 (0.0.150): an
// example opened after a project was saved over that project's file.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startHeadless, stlBytes, type Headless } from './commandKit'
import { boxMesh } from './helpers'
import { headlessProjectIo } from '../src/app/headlessProject'
import { recentProjectTargets, type ProjectWriter } from '../src/app/projectWriter'
import { useDocument } from '../src/state/documentStore'
import type { ProjectIo } from '../src/app/projectIo'

vi.setConfig({ testTimeout: 60_000 })
const BOX = stlBytes(boxMesh(40, 40))
type Call = { name: string; saveAs: boolean; token: string | null; file: File | null }

describe('the document Save writes back to', () => {
  let h: Headless
  let io: ProjectIo
  let calls: Call[]
  beforeEach(async () => {
    h = await startHeadless()
    calls = []
    let n = 0
    const writer: ProjectWriter = {
      async saveProject(name, _bytes, saveAs, token, file) {
        calls.push({ name, saveAs, token, file })
        return { canceled: false, name, token: `tok-${++n}` }
      },
    }
    io = headlessProjectIo(h.session, { writer: () => writer })
  })
  afterEach(() => h.stop())

  const openScan = (name: string) => h.session.scan.openScan(new File([BOX as BlobPart], name), 'mm')

  it('Save As asks; Save then writes the same file back; a scan opened after is a new document that asks again (D-01)', async () => {
    await openScan('box.stl')
    expect(useDocument.getState().origin).toBe('scan')
    await io.saveProjectAs()
    expect(calls.at(-1)).toMatchObject({ name: 'box.scanruler', saveAs: true, token: null, file: null })
    expect(useDocument.getState()).toMatchObject({ origin: 'project', token: 'tok-1' })

    await io.saveProject()
    expect(calls.at(-1)).toMatchObject({ saveAs: false, token: 'tok-1' })

    // The D-01 case: an example (a scan) opened in place of the session.
    await openScan('example.stl')
    expect(useDocument.getState()).toMatchObject({ origin: 'scan', token: null, file: null })
    await io.saveProject()
    expect(calls.at(-1)).toMatchObject({ name: 'example.scanruler', saveAs: false, token: null, file: null })
  })

  it('a project opened from a file is written back to that file; New Project forgets it', async () => {
    await openScan('box.stl')
    const packed = await io.packProject()
    if ('error' in packed) throw new Error(packed.error)
    const fileA = new File([packed.bytes as BlobPart], 'a.scanruler')
    recentProjectTargets.set(fileA, 'recent-a')
    await io.openProject(fileA, false, true)
    expect(useDocument.getState()).toMatchObject({ origin: 'project', file: fileA, token: 'recent-a' })
    await io.saveProject()
    expect(calls.at(-1)).toMatchObject({ saveAs: false, token: 'recent-a', file: fileA })

    await io.newProject(true)
    expect(useDocument.getState()).toMatchObject({ origin: 'new', file: null, token: null })
  })

  it('a canceled save leaves the document where it was', async () => {
    const canceling: ProjectWriter = { async saveProject() { return { canceled: true } } }
    const io2 = headlessProjectIo(h.session, { writer: () => canceling })
    await openScan('box.stl')
    const before = useDocument.getState().generation
    const out = await io2.saveProject()
    expect(out).toEqual({ error: 'Save canceled.' })
    expect(useDocument.getState()).toMatchObject({ origin: 'scan', token: null, generation: before })
  })
})
