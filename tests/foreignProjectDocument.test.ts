// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it, vi } from 'vitest'
import { startHeadless, stlBytes } from './commandKit'
import { boxMesh } from './helpers'
import { headlessProjectIo } from '../src/app/headlessProject'
import { registerProjectReader } from '../src/app/projectReaders'
import { unpackProject } from '../src/core/project/archive'
import { useDocument } from '../src/state/documentStore'
import { useStore } from '../src/state/store'
import type { ProjectWriter } from '../src/app/projectWriter'

vi.setConfig({ testTimeout: 60_000 })
it('foreign conversion never gives Save the original file as a write-back target', async () => {
  const h = await startHeadless()
  const write = vi.fn(async (..._args: Parameters<ProjectWriter['saveProject']>) => ({ canceled: false as const, name: 'copy.scanruler', token: 'copy' }))
  const io = headlessProjectIo(h.session, { writer: () => ({ saveProject: write }) })
  let remove = () => {}
  try {
    await h.session.scan.openScan(new File([stlBytes(boxMesh(10, 10)) as BlobPart], 'box.stl'), 'mm')
    const packed = await io.packProject(); if ('error' in packed) throw Error(packed.error)
    remove = registerProjectReader({ extension: '.foreign', label: 'Foreign', read: async () => unpackProject(packed.bytes) })
    await io.openProject(new File([new Uint8Array([1])], 'part.foreign'), false, true)
    expect(useDocument.getState()).toMatchObject({ origin: 'scan', file: null, token: null })
    await io.saveProject()
    expect(write).toHaveBeenCalled()
    expect(write.mock.calls[0].slice(3)).toEqual([null, null])
  } finally { remove(); h.stop() }
})
it('an unsupported foreign record leaves the current document intact', async () => {
  const h = await startHeadless(), io = headlessProjectIo(h.session)
  const remove = registerProjectReader({ extension: '.foreign', label: 'Foreign', read: async () => { throw Error('Unsupported native constraint') } })
  try {
    await h.session.scan.openScan(new File([stlBytes(boxMesh(10, 10)) as BlobPart], 'keep.stl'), 'mm')
    const generation = useDocument.getState().generation
    await io.openProject(new File([new Uint8Array([1])], 'unsupported.foreign'), false, true)
    expect(useStore.getState().fileName).toBe('keep.stl')
    expect(useDocument.getState().generation).toBe(generation)
    expect(useStore.getState().errorText).toContain('Unsupported native constraint')
  } finally { remove(); h.stop() }
})
