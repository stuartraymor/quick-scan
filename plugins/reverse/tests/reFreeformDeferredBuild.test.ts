// SPDX-License-Identifier: AGPL-3.0-only
// While New Freeform edits a control surface its CAD body is not rebuilt
// after every quad: the editor draws the surface itself, as QUICKSURFACE
// does, and the body is built once the editing pauses, the editor closes or
// something waits for the part. Each finished quad used to start a 1.1–2.3 s
// kernel build (the user's 111-face aerosol cage, 2026-11-17).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReClient, type ReTransport } from '../core/reClient'
import type { ReWorkerRequest } from '../core/reService'
import type { Feature, FreeformFeature } from '../core/features'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { useReverse } from '../state/reStore'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 120_000 })

function counted() {
  const inner = localKernel()
  let builds = 0
  const transport: ReTransport = {
    onFailure: null,
    onEvent: null,
    request<T>(msg: { requestId: number }, transfer: Transferable[], limitMs?: number): Promise<T> {
      if ((msg as ReWorkerRequest).type === 'build') builds++
      return inner.request<T>(msg, transfer, limitMs)
    },
    dispose() { inner.dispose() },
  }
  inner.onEvent = (e) => transport.onEvent?.(e)
  return { transport, builds: () => builds }
}

const quad = (z: number): FreeformFeature => ({ id: 1, kind: 'freeform', name: 'Freeform 1', positions: [0, 0, 0, 10, 0, z, 10, 10, 0, 0, 10, z], faces: [[0, 1, 2, 3]], creases: [], steps: 2, snap: false, fitToScan: false, visible: true })

const stops: (() => void)[] = []
let kernel: ReturnType<typeof counted>
let session: ReverseSession

beforeEach(async () => {
  resetReverse()
  useReverse.setState({ kernelStatus: 'idle' })
  kernel = counted()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(kernel.transport) })
  stops.push(installReverseSession(session), session.watch())
  await session.startKernel()
})
afterEach(() => {
  vi.useRealTimers()
  for (const stop of stops.splice(0)) stop()
  session.client()?.dispose()
})

const setFeatures = (features: Feature[]) => useReverse.setState((s) => ({ features, buildVersion: s.buildVersion + 1 }))

describe('deferred control-surface builds', () => {
  it('builds once when editing stops, not after every edit, and never shows Building meanwhile', async () => {
    setFeatures([quad(0)])
    await session.settled(30_000)
    const before = kernel.builds()
    session.deferBuilds(true)
    for (const z of [1, 2, 3]) {
      setFeatures([quad(z)])
      await Promise.resolve()
      expect(useReverse.getState().building).toBe(false)
    }
    await new Promise((r) => setTimeout(r, 50))
    expect(kernel.builds()).toBe(before)
    session.deferBuilds(false)
    await session.settled(30_000)
    expect(kernel.builds()).toBe(before + 1)
    expect(session.buildState()).toBe('built')
  })

  it('builds after a pause in editing while the editor stays open', async () => {
    setFeatures([quad(0)])
    await session.settled(30_000)
    const before = kernel.builds()
    session.deferBuilds(true)
    setFeatures([quad(2)])
    await new Promise((r) => setTimeout(r, 50))
    expect(kernel.builds()).toBe(before)
    await vi.waitFor(() => expect(kernel.builds()).toBe(before + 1), { timeout: 10_000, interval: 100 })
    await session.settled(30_000)
    session.deferBuilds(false)
    expect(kernel.builds()).toBe(before + 1)
  })

  it('a wait for the part (settled) builds the deferred edit at once', async () => {
    setFeatures([quad(0)])
    await session.settled(30_000)
    const before = kernel.builds()
    session.deferBuilds(true)
    setFeatures([quad(4)])
    const began = Date.now()
    await session.settled(30_000)
    expect(Date.now() - began).toBeLessThan(2_500)
    expect(kernel.builds()).toBe(before + 1)
    expect(session.buildState()).toBe('built')
    session.deferBuilds(false)
    expect(kernel.builds()).toBe(before + 1)
  })
})
