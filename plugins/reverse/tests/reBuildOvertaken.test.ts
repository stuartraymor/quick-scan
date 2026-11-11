// SPDX-License-Identifier: AGPL-3.0-only
// A kernel build overtaken by one of sketches alone does not land after it.
// A project of sketches only (a .qsf of three sketches) opened while the
// part before it was still building in the kernel landed at once, with no
// bodies; the kernel's late answer for the old part then landed on top of
// it: the old solid listed again, the old version marked built, and the
// open's wait for the new one never ended — Quick Scan stuck on "Reading
// file…" with Save greyed out (e2e-qsf-project, 2026-11-11).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addRectangle } from '../core/sketch'
import { ReClient, type ReTransport } from '../core/reClient'
import type { ReWorkerRequest } from '../core/reService'
import type { Feature } from '../core/features'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { useReverse } from '../state/reStore'
import { extrudeAll, sketchOf } from './reKit'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 120_000 })

/** The kernel in this thread, its build answers held until let go. */
function gated() {
  const inner = localKernel()
  const held: (() => void)[] = []
  let asked = 0
  const transport: ReTransport = {
    onFailure: null,
    onEvent: null,
    request<T>(msg: { requestId: number }, transfer: Transferable[], limitMs?: number): Promise<T> {
      const answer = inner.request<T>(msg, transfer, limitMs)
      if ((msg as ReWorkerRequest).type !== 'build') return answer
      asked++
      return new Promise<T>((resolve, reject) => held.push(() => void answer.then(resolve, reject)))
    },
    dispose() {
      inner.dispose()
    },
  }
  inner.onEvent = (e) => transport.onEvent?.(e)
  return { transport, asked: () => asked, letGo: () => held.splice(0).forEach((go) => go()) }
}

const stops: (() => void)[] = []
let gate: ReturnType<typeof gated>
let session: ReverseSession

beforeEach(async () => {
  resetReverse()
  useReverse.setState({ kernelStatus: 'idle' })
  gate = gated()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(gate.transport) })
  stops.push(installReverseSession(session), session.watch())
  await session.startKernel()
})
afterEach(() => {
  for (const stop of stops.splice(0)) stop()
  session.client()?.dispose()
})

const setFeatures = (features: Feature[]) => useReverse.setState((s) => ({ features, buildVersion: s.buildVersion + 1 }))

describe('an overtaken kernel build', () => {
  it('answering after a build of sketches alone has landed, is dropped: the bodies stay none and the wait ends', async () => {
    const outline = sketchOf(1, (s) => addRectangle(s, [0, 0], [30, 20]))
    setFeatures([outline, extrudeAll(2, outline, 0, 5, 'new')])
    await vi.waitFor(() => expect(gate.asked()).toBe(1))
    // The next project: sketches alone — built at once, no kernel.
    setFeatures([sketchOf(1, (s) => addRectangle(s, [0, 0], [10, 10])), sketchOf(2, (s) => addRectangle(s, [20, 0], [30, 10]))])
    await Promise.resolve()
    expect(useReverse.getState().bodies).toHaveLength(0)
    // The old part's answer comes in late.
    gate.letGo()
    await session.settled(5_000)
    expect(useReverse.getState().bodies).toHaveLength(0)
    expect(useReverse.getState().building).toBe(false)
    expect(session.buildState()).toBe('built')
  })

  it('the latest kernel build still lands', async () => {
    const outline = sketchOf(1, (s) => addRectangle(s, [0, 0], [30, 20]))
    setFeatures([outline, extrudeAll(2, outline, 0, 5, 'new')])
    await vi.waitFor(() => expect(gate.asked()).toBe(1))
    gate.letGo()
    await session.settled(30_000)
    expect(useReverse.getState().bodies).toHaveLength(1)
  })
})
