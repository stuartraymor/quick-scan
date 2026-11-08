// SPDX-License-Identifier: AGPL-3.0-only
// Duplicate Face, through the commands: the picked faces of a body copied
// into a sheet body of its own, sewn where they meet edge to edge, the
// source untouched. A box's faces one, two adjacent and two apart; a
// cylinder's curved face; faces picked by query following an edit of the
// source; the sheet thickened into a solid; a face that is gone refused;
// the feature saved and read back, undone and redone. A 10 × 6 × 4 box
// (faces: top and bottom 60, the x sides 24, the y sides 40 mm²) in the
// in-process worker, the kernel in this thread.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { boxMesh } from '../../../tests/helpers'
import { refused, run, startHeadless, stlBytes, undoLabels, type Headless } from '../../../tests/commandKit'
import { applyReversePart, collectReversePart, validateReversePart } from '../app/projectSection'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { Builder } from '../core/build'
import type { Feature } from '../core/features'
import { ReClient } from '../core/reClient'
import { ReKernel } from '../core/kernel'
import plugin from '../plugin'
import { useReverse } from '../state/reStore'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'
import { build, extrudeAll, rectangleSketch } from './reKit'

vi.setConfig({ testTimeout: 180_000 })

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  await run('scan.open', { bytes: stlBytes(boxMesh(40, 40)), name: 'box.stl', discard: true })
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(resetReverse)

interface Face { index: number; kind: string; area: number; centroid: number[]; normal: number[]; madeBy: { id: number; name: string | null } }
interface Described { bodies: { id: number; name: string; volume: number; faces: number; surface?: boolean; closed: boolean; faceList: Face[] }[] }
interface Added { result?: { status: string; message?: string; warning?: string; bodies?: number[] }; note?: string; warnings?: string[] }

const describeBody = async (body: string) => (await run<Described>('reverse.body.describe', { body, edges: false })).bodies[0]
const areaOf = (b: Described['bodies'][number]) => b.faceList.reduce((sum, f) => sum + f.area, 0)

/** The 10 × 6 × 4 box "Block", z from 0 to 4. */
async function block() {
  await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Plan', plane: { kind: 'world', axis: 'z', offset: 0 }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [0, 0], size: [10, 6], fixed: true }] } } })
  const r = await run<Added>('reverse.feature.add', { feature: { kind: 'extrude', name: 'Block', sketchId: 'Plan', regions: 'all', extent: { kind: 'distance', from: 0, to: 4 }, op: 'new' } })
  expect(r.result?.status, r.result?.message).toBe('ok')
}

/** A face of the box by its outward normal. */
const facing = (n: [number, number, number]) => ({ kind: 'plane', between: [n] })

const duplicate = (faces: unknown[], extra: Record<string, unknown> = {}) => run<Added>('reverse.feature.add', { feature: { kind: 'duplicateFace', name: 'Copy', body: 'Block', faces, ...extra } })

describe('duplicate face through the commands', () => {
  it('copies one face of a box into a sheet of its area and leaves the box as it was', async () => {
    await block()
    const out = await duplicate([facing([0, 0, 1])])
    expect(out.result?.status, out.result?.message).toBe('ok')
    expect(out.result?.warning).toBeUndefined()
    expect(out.note).toMatch(/new sheet body \d+ \(Shell 1\) beside Solid 1 \(\d+\); Solid 1 unchanged/)
    const sheet = await describeBody('Copy')
    expect(sheet).toMatchObject({ name: 'Shell 1', surface: true, closed: false, volume: 0, faces: 1 })
    expect(areaOf(sheet)).toBeCloseTo(60, 6)
    // The copy faces outward, as the face it copies; its maker is the extrude's.
    expect(sheet.faceList[0].normal[2]).toBeCloseTo(1, 6)
    expect(sheet.faceList[0].madeBy.name).toBe('Block')
    // The source: volume, faces and area as they were.
    const box = await describeBody('Block')
    expect(box.volume).toBeCloseTo(240, 6)
    expect(box.faces).toBe(6)
    expect(areaOf(box)).toBeCloseTo(248, 6)
    expect(box.surface).toBeFalsy()
    expect((await run<{ bodies: unknown[] }>('reverse.body.describe', { edges: false })).bodies).toHaveLength(2)
  })

  it('sews two adjacent faces into one sheet of the summed area', async () => {
    await block()
    const out = await duplicate([facing([0, 0, 1]), facing([1, 0, 0])])
    expect(out.result?.status, out.result?.message).toBe('ok')
    expect(out.result?.warning).toBeUndefined()
    const sheet = await describeBody('Copy')
    expect(sheet.faces).toBe(2)
    expect(areaOf(sheet)).toBeCloseTo(60 + 24, 6)
    expect(sheet.surface).toBe(true)
    // One piece: a single sheet a thicken can take (two pieces apart would not be one shell).
    expect((await run<Described>('reverse.body.describe', { edges: false })).bodies.filter((b) => b.surface)).toHaveLength(1)
  })

  it('reports faces that do not meet as two pieces apart, and still makes the sheet', async () => {
    await block()
    const out = await duplicate([facing([1, 0, 0]), facing([-1, 0, 0])])
    expect(out.result?.status, out.result?.message).toBe('ok')
    expect(JSON.stringify(out)).toMatch(/Copy came out as 2 pieces apart/)
    const sheet = await describeBody('Copy')
    expect(sheet.faces).toBe(2)
    expect(areaOf(sheet)).toBeCloseTo(48, 6)
  })

  it('copies a cylinder’s curved face', async () => {
    await run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Disc', plane: { kind: 'world', axis: 'z', offset: 0 }, sketch: { entities: [{ id: 1, kind: 'circle', c: [0, 0], r: 5 }] } } })
    await run('reverse.feature.add', { feature: { kind: 'extrude', name: 'Block', sketchId: 'Disc', regions: 'all', extent: { kind: 'distance', from: 0, to: 10 }, op: 'new' } })
    const out = await duplicate([{ kind: 'cylinder' }])
    expect(out.result?.status, out.result?.message).toBe('ok')
    const sheet = await describeBody('Copy')
    expect(sheet.faces).toBe(1)
    expect(sheet.faceList[0].kind).toBe('cylinder')
    expect(areaOf(sheet)).toBeCloseTo(2 * Math.PI * 5 * 10, 1)
    expect(sheet.surface).toBe(true)
    expect((await describeBody('Block')).volume).toBeCloseTo(Math.PI * 25 * 10, 1)
  })

  it('follows the source: faces picked by query are found again when it is edited', async () => {
    await block()
    await duplicate([facing([1, 0, 0])])
    expect(areaOf(await describeBody('Copy'))).toBeCloseTo(24, 6)
    const edited = await run<Added>('reverse.feature.update', { feature: 'Block', set: { extent: { kind: 'distance', from: 0, to: 8 } } })
    expect(edited.result?.status, edited.result?.message).toBe('ok')
    // The same side, now twice as tall.
    expect(areaOf(await describeBody('Copy'))).toBeCloseTo(48, 6)
    expect((await describeBody('Block')).volume).toBeCloseTo(480, 6)
  })

  it('makes a sheet the Thicken takes: a solid of the right volume', async () => {
    await block()
    await duplicate([facing([0, 0, 1])])
    const out = await run<Added>('reverse.feature.add', { feature: { kind: 'thicken', name: 'Plate', sheet: 'Copy', thickness: 2, side: 'out' } })
    expect(out.result?.status, out.result?.message).toBe('ok')
    // 60 mm² of top face, 2 mm thick, outward (+Z): a plate on the box's top.
    const plate = await describeBody('Plate')
    expect(plate.volume).toBeCloseTo(60 * 2, 4)
    expect(plate.surface).toBeFalsy()
    // Two adjacent faces thicken too, as one sheet.
    await run('reverse.feature.add', { feature: { kind: 'duplicateFace', name: 'Corner', body: 'Block', faces: [facing([0, 0, 1]), facing([0, 1, 0])] } })
    const wall = await run<Added>('reverse.feature.add', { feature: { kind: 'thicken', name: 'Corner wall', sheet: 'Corner', thickness: 1, side: 'in' } })
    expect(wall.result?.status, wall.result?.message).toBe('ok')
    // 60 + 40 of slab, less the 10 mm² × 1 mm where the two slabs overlap along the shared edge.
    expect((await describeBody('Corner wall')).volume).toBeCloseTo(60 + 40 - 10, 4)
  })

  it('refuses what cannot be copied, saying so', async () => {
    await block()
    // No face picked.
    const none = await refused('reverse.feature.add', { feature: { kind: 'duplicateFace', body: 'Block', faces: [] } })
    expect(none.message).toMatch(/faces/)
    // A query that names no face.
    const nowhere = await refused('reverse.feature.add', { feature: { kind: 'duplicateFace', body: 'Block', faces: [{ kind: 'plane', near: { at: [100, 100, 100], radius: 1 } }] } })
    expect(nowhere.code).toBe('not_found')
    // Nothing was made by either.
    expect(useReverse.getState().features.some((f) => f.kind === 'duplicateFace')).toBe(false)
  })

  it('is saved with the project, read back and rebuilt', async () => {
    await block()
    await duplicate([facing([0, 0, 1]), facing([0, -1, 0])])
    expect(areaOf(await describeBody('Copy'))).toBeCloseTo(60 + 40, 6)
    const part = collectReversePart()!
    const saved = part.features.find((f) => f.kind === 'duplicateFace')!
    expect(saved).toMatchObject({ kind: 'duplicateFace', name: 'Copy', visible: true })
    expect((saved as Extract<Feature, { kind: 'duplicateFace' }>).faces).toHaveLength(2)
    expect((saved as Extract<Feature, { kind: 'duplicateFace' }>).facesWhere).toHaveLength(2)
    const read = validateReversePart(JSON.parse(JSON.stringify(part)))
    // A new session: the file's features alone, built again.
    resetReverse()
    applyReversePart(read)
    const again = await describeBody('Copy')
    expect(again.surface).toBe(true)
    expect(areaOf(again)).toBeCloseTo(60 + 40, 6)
    expect((await describeBody('Block')).volume).toBeCloseTo(240, 6)
  })

  it('is one undo step, and comes back redone', async () => {
    await block()
    await duplicate([facing([0, 0, 1])])
    expect(undoLabels().at(-1)).toMatch(/Copy/)
    await run('history.undo')
    expect((await run<Described>('reverse.body.describe', { edges: false })).bodies.map((b) => b.name)).toEqual(['Solid 1'])
    expect(useReverse.getState().features.some((f) => f.kind === 'duplicateFace')).toBe(false)
    await run('history.redo')
    expect(areaOf(await describeBody('Copy'))).toBeCloseTo(60, 6)
  })

  it('takes whole: each face with what a click on it takes', async () => {
    await block()
    // On a box a face is only itself: the same sheet as without whole.
    const out = await duplicate([facing([0, 0, 1])], { whole: true })
    expect(out.result?.status, out.result?.message).toBe('ok')
    expect(areaOf(await describeBody('Copy'))).toBeCloseTo(60, 6)
    const f = useReverse.getState().features.find((x) => x.kind === 'duplicateFace')!
    expect((f as { facesWhere?: unknown }).facesWhere).toBeUndefined()
  })
})

describe('duplicate face in the builder', () => {
  const kernelPromise = ReKernel.load()

  it('refuses a face that is gone, and a pick of none, with a message', async () => {
    const builder = new Builder(await kernelPromise)
    const s = rectangleSketch(1, 10, 6)
    const box = extrudeAll(2, s, 0, 4)
    // A fingerprint of a face no face of the box answers.
    const gone: Feature = {
      id: 3,
      kind: 'duplicateFace',
      name: 'Copy',
      body: 2,
      faces: [{ kind: 'plane', centroid: [50, 50, 50], dir: [1, 0, 0], area: 3, origin: 2 }],
      visible: true,
    }
    const lost = await build(builder, [s, box, gone])
    expect(lost.results.find((r) => r.id === 3)).toMatchObject({ status: 'failed', message: expect.stringMatching(/A face this feature duplicates is gone/) })
    expect(lost.bodies.map((b) => b.id)).toEqual([2])
    const empty = await build(builder, [s, box, { ...gone, faces: [] }])
    expect(empty.results.find((r) => r.id === 3)).toMatchObject({ status: 'failed', message: 'Pick the faces to duplicate.' })
    // The body it copies from is gone.
    const orphan = await build(builder, [s, { ...gone, body: 9, faces: [{ ...gone.faces[0] }] }])
    expect(orphan.results.find((r) => r.id === 3)?.status).toBe('failed')
    builder.dispose()
  })

  it('copies faces of a sheet too, the copies’ makers kept', async () => {
    const builder = new Builder(await kernelPromise)
    const s = rectangleSketch(1, 10, 6)
    const box = extrudeAll(2, s, 0, 4)
    const top: Feature = { id: 3, kind: 'duplicateFace', name: 'Copy', body: 2, faces: [{ kind: 'plane', centroid: [5, 3, 4], dir: [0, 0, 1], area: 60, origin: 2 }], visible: true }
    const again: Feature = { id: 4, kind: 'duplicateFace', name: 'Copy of copy', body: 3, faces: [{ kind: 'plane', centroid: [5, 3, 4], dir: [0, 0, 1], area: 60, origin: 2 }], visible: true }
    const out = await build(builder, [s, box, top, again])
    expect(out.results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok'])
    expect(out.bodies.map((b) => b.id)).toEqual([2, 3, 4])
    expect(out.bodies.filter((b) => b.surface).map((b) => b.id)).toEqual([3, 4])
    builder.dispose()
  })
})
