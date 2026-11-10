// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest'
import { inspectQsfProject, readQsfProject, qsfSourceSection, QSF_SOURCE_MEMBER } from '../app/qsfProject'
import { packProject, unpackProject } from '../../../src/core/project/archive'
import { blankManifest } from '../../../src/app/project'
import { scanLoaded } from '../../../src/app/scanEvents'
import { useReverse } from '../state/reStore'
import { useStore } from '../../../src/state/store'
import { readFileSync } from 'node:fs'
import { readQsfContainer } from '../core/qsfContainer'
import { decodeQsfSketch } from '../core/qsfSketch'
import { ReKernel } from '../core/kernel'
import { Builder } from '../core/build'
import { resolveFeatures } from '../core/resolve'
import { findRegions } from '../core/regions'
import { solveSketch } from '../core/solver'
import type { Feature, SketchFeature } from '../core/features'
import type { ReversePart } from '../app/projectSection'

function mesh() {
  const name = 'Mesh', end = 124 + name.length * 2, at = end + 28
  const b = new Uint8Array(at + 4 + 36 + 4 + 12), v = new DataView(b.buffer)
  v.setUint32(0, 0x1a2b3c04, true); v.setUint32(28, 0x006b7376, true); v.setUint32(32, 0x08000101, true)
  const guid = Uint8Array.from({ length: 16 }, (_, i) => i + 1); b.set(guid, 12); b.set(guid, end)
  v.setUint32(120, name.length, true); for (let i = 0; i < name.length; i++) v.setUint16(124 + i * 2, name.charCodeAt(i), true)
  v.setUint32(at, 3, true); [0, 0, 0, 10, 0, 0, 0, 10, 0].forEach((x, i) => v.setFloat32(at + 4 + i * 4, x, true))
  v.setUint32(at + 40, 1, true); [0, 1, 2].forEach((x, i) => v.setUint32(at + 44 + i * 4, x, true))
  return b
}
function file(records: { type: number; bytes: Uint8Array }[] = [{ type: 4, bytes: mesh() }]) {
  const start = 148 + 24 * records.length, out = new Uint8Array(start + records.reduce((a, r) => a + r.bytes.length, 0)), v = new DataView(out.buffer)
  ;[0x37dc4ef7, 1, 4, 0x00800008, 1].forEach((x, i) => v.setUint32(i * 4, x, true)); v.setUint32(144, records.length, true)
  let offset = start
  records.forEach((r, i) => { v.setUint32(148 + i * 8, r.type, true); v.setUint32(152 + i * 8, offset, true); const wide = 148 + records.length * 8 + i * 16; v.setBigUint64(wide, BigInt(r.type), true); v.setBigUint64(wide + 8, BigInt(offset), true); out.set(r.bytes, offset); offset += r.bytes.length })
  return out
}
const sources = { scan: null, reference: null, image: null }
describe('atomic supported QSF project conversion', () => {
  beforeEach(() => { scanLoaded(null) })
  it.each([false, true])('stages a complete supported project with user filename and independent source bytes (Buffer=%s)', async buffer => {
    const b = buffer ? Buffer.from(file()) : file(), before = Uint8Array.from(b), core = useStore.getState(), reverse = useReverse.getState()
    const out = await readQsfProject(b, 'C:\\work\\My project.QSF')
    expect(out.manifest.name).toBe('My project'); expect(out.manifest.workspace).toBe('reverse')
    expect(out.manifest.scan?.fileName).toBe('Mesh.obj')
    expect(new TextDecoder().decode(out.members.get('scan.obj'))).toContain('f 1 2 3')
    expect(out.manifest.reverse).toMatchObject({ features: [], nextFeatureId: 1 })
    expect(useStore.getState()).toBe(core); expect(useReverse.getState()).toBe(reverse)
    b.fill(0); expect(out.members.get(QSF_SOURCE_MEMBER)).toEqual(before)
  })
  it('rejects the whole document when an unsupported feature follows a valid scan', async () => {
    const b = file([{ type: 4, bytes: mesh() }, { type: 7, bytes: new Uint8Array(4) }])
    const before = useReverse.getState()
    const report = inspectQsfProject(b, 'unsupported.qsf')
    expect(report.supported).toBe(false); expect(report.records.find(r => r.type === 7)?.supported).toBe(false)
    await expect(readQsfProject(b, 'unsupported.qsf')).rejects.toThrow('current project was not changed')
    expect(useReverse.getState()).toBe(before)
  })
  it('rejects changed mesh state and multiple meshes', async () => {
    const m = mesh(); m[40] = 1
    await expect(readQsfProject(file([{ type: 4, bytes: m }]), 'pose.qsf')).rejects.toThrow()
    await expect(readQsfProject(file([{ type: 4, bytes: mesh() }, { type: 4, bytes: mesh() }]), 'two.qsf')).rejects.toThrow()
  })
  it('bounds unsupported-record error text', async () => {
    const b = file([{ type: 4, bytes: mesh() }, ...Array.from({ length: 100 }, () => ({ type: 99, bytes: new Uint8Array(4) }))])
    try { await readQsfProject(b, 'many.qsf'); throw Error('Expected rejection') }
    catch (e) { expect((e as Error).message.length).toBeLessThan(2200); expect((e as Error).message).toContain('92 more unsupported records') }
  })
  it('retains original source through save-as/reopen without treating it as editable features', async () => {
    const original = file(), project = await readQsfProject(original, 'native.qsf')
    const restore = qsfSourceSection.prepare(project.manifest.qsfSource, project)
    let added: { name: string; bytes: Uint8Array }[] = []
    expect(qsfSourceSection.collect({ sources, scanSaved: true, addMember: (name, bytes) => added.push({ name, bytes }) })).toBeUndefined()
    restore()
    const source = qsfSourceSection.collect({ sources, scanSaved: true, addMember: (name, bytes) => added.push({ name, bytes }) })
    expect(source).toMatchObject({ fileName: 'native.qsf' }); expect(added[0].bytes).toEqual(original)
    const saved = { ...project.manifest, name: 'New name', qsfSource: source }
    const roundtrip = unpackProject(packProject(saved, [{ name: 'scan.obj', bytes: project.members.get('scan.obj')! }, ...added]))
    expect(roundtrip.manifest.name).toBe('New name'); expect(roundtrip.members.get(QSF_SOURCE_MEMBER)).toEqual(original)
    scanLoaded(null); added = []
    expect(qsfSourceSection.collect({ sources, scanSaved: true, addMember: (name, bytes) => added.push({ name, bytes }) })).toBeUndefined()
    qsfSourceSection.prepare(roundtrip.manifest.qsfSource, roundtrip)()
    expect(qsfSourceSection.collect({ sources, scanSaved: false, addMember() {} })).toBeUndefined()
    expect(qsfSourceSection.collect({ sources, scanSaved: true, addMember() {} })).toEqual(source)
  })
  it('fails missing provenance during preparation without clearing live provenance', async () => {
    const project = await readQsfProject(file(), 'source.qsf'); qsfSourceSection.prepare(project.manifest.qsfSource, project)()
    expect(() => qsfSourceSection.prepare(project.manifest.qsfSource, { manifest: blankManifest('test'), members: new Map() })).toThrow('missing')
    expect(qsfSourceSection.collect({ sources, scanSaved: true, addMember() {} })).toMatchObject({ fileName: 'source.qsf' })
  })
})

const nativeRoot = new URL('./fixtures/qsf/', import.meta.url)
describe('independent native cylinder project evidence', () => {
  it.each([false, true])('preserves measured sketch visibility (%s)', async visible => {
    const bytes = readFileSync(new URL('cylinder-solid.qsf', nativeRoot))
    const r = readQsfContainer(bytes).records.find(r => r.type === 16)!
    new DataView(r.bytes.buffer, r.bytes.byteOffset).setUint32(32, visible ? 1 : 0, true)
    const result = await readQsfProject(bytes, 'visibility.qsf')
    expect((result.manifest.reverse as ReversePart).features[0].visible).toBe(visible)
  })
  it('keeps unverified coincident constraints an atomic refusal', async () => {
    const bytes = readFileSync(new URL('cylinder-solid.qsf', nativeRoot))
    const r = readQsfContainer(bytes).records.find(r => r.type === 16)!, raw = decodeQsfSketch(r.bytes).constraints[0].raw
    const offset = r.bytes.findIndex((_, i) => i + raw.length <= r.bytes.length && raw.every((b, j) => b === r.bytes[i + j]))
    expect(offset).toBeGreaterThan(0)
    const view = new DataView(r.bytes.buffer, r.bytes.byteOffset)
    view.setUint32(offset + 16, 2, true); view.setInt32(offset + 52, 0, true); view.setInt32(offset + 56, 1, true)
    expect(decodeQsfSketch(r.bytes).constraints[0].semantic).toBe('coincident')
    const before = useReverse.getState()
    await expect(readQsfProject(bytes, 'unsupported-coincidence.qsf')).rejects.toThrow('Constraint metadata mapping is not verified')
    expect(useReverse.getState()).toBe(before)
  })
  it('projects world references into the measured empty X2 frame', async () => {
    const original = readQsfContainer(readFileSync(new URL('cylinder-solid.qsf', nativeRoot)))
    const source = original.records.find(r => r.type === 16)!.bytes
    const end = 124 + new DataView(source.buffer, source.byteOffset).getUint32(120, true) * 2
    const a = [...source.subarray(0, end + 24)], raw = (bytes: Uint8Array) => { a.push(...bytes) }
    const u = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); raw(b) }
    const number = (n: number, single = false) => { const b = new Uint8Array(single ? 4 : 8), v = new DataView(b.buffer); if (single) v.setFloat32(0, n, true); else v.setFloat64(0, n, true); raw(b) }
    const zero = (n: number) => raw(new Uint8Array(n))
    const rotation = [0, 0, 1, 2, 1, 0, 0, 0, 0, 1, 0, 0]
    u(0); u(0); u(1); u(11); raw(Uint8Array.from('72fab92cb9c8e54d88de526080553831'.match(/../g)!.map(x => parseInt(x, 16))))
    u(1); u(2); rotation.forEach(x => number(x)); [2, 3, -5, 2, 7, 11].forEach(x => number(x, true))
    rotation.forEach(x => number(x)); zero(76); u(1); u(0); u(0); u(0); u(0); u(1); zero(1); u(1); u(0); u(1); u(0)
    const sketch = Uint8Array.from(a)
    const imported = await readQsfProject(file([{ type: 4, bytes: original.records[0].bytes }, { type: 16, bytes: sketch }]), 'empty-X2.qsf')
    const feature = (imported.manifest.reverse as ReversePart).features[0] as SketchFeature
    expect(feature.frame).toEqual({ origin: [2, 0, 0], normal: [1, 0, 0], basisU: [0, 1, 0], basisV: [0, 0, 1] })
    expect(feature.sketch.referenceChains).toEqual([[[3, -5], [7, 11]]])
    expect(feature.plane).toEqual({ kind: 'fitted', frame: feature.frame })
  })
  it('preserves interleaved native feature order and assigns independent IDs', async () => {
    const source = readQsfContainer(readFileSync(new URL('cylinder-solid.qsf', nativeRoot)))
    const repeated = source.records.filter(r => [16, 17, 62, 48].includes(r.type)).map(r => ({ type: r.type, bytes: Uint8Array.from(r.bytes) }))
    for (const original of source.records.filter(r => [16, 17].includes(r.type))) {
      const old = original.bytes.subarray(12, 28), replacement = old.map(x => x ^ 0x55)
      for (const r of repeated) for (let i = 0; i <= r.bytes.length - 16; i++) if (old.every((x, j) => r.bytes[i + j] === x)) { r.bytes.set(replacement, i); i += 15 }
    }
    const imported = await readQsfProject(file([...source.records, ...repeated]), 'interleaved.qsf')
    const part = imported.manifest.reverse as ReversePart
    expect(part.features.map(f => f.kind)).toEqual(['sketch', 'extrude', 'sketch', 'extrude'])
    expect(part.features.map(f => f.id)).toEqual([1, 3, 2, 4])
    expect(part.nextFeatureId).toBe(5)
  })
  it.each([8, 16, 17])('rejects changed type%i metadata without replacing the session', async type => {
    const bytes = readFileSync(new URL('cylinder-solid.qsf', nativeRoot))
    const record = readQsfContainer(bytes).records.find(r => r.type === type)!
    record.bytes[40] = 1
    const state = useReverse.getState()
    await expect(readQsfProject(bytes, 'changed-flags.qsf')).rejects.toThrow('pose/display')
    expect(useReverse.getState()).toBe(state)
  })
  it('preserves driving diameter, datum, feature dependencies and editable regeneration after save/reopen', async () => {
    const kernel = await ReKernel.load()
    const imported = await readQsfProject(readFileSync(new URL('cylinder-solid.qsf', nativeRoot)), 'cylinder-solid.qsf')
    const roundtrip = unpackProject(packProject(imported.manifest, [...imported.members].map(([name, bytes]) => ({ name, bytes }))))
    const features = (roundtrip.manifest.reverse as ReversePart).features as Feature[]
    expect(features.map(f => f.kind)).toEqual(['sketch', 'extrude'])
    expect((roundtrip.manifest.reverse as ReversePart).nextFeatureId).toBe(3)
    expect(roundtrip.manifest.scan?.nextId).toBe(2)
    expect(roundtrip.manifest.scan?.elements[0].source).toMatchObject({ type: 'constructed', method: 'plane-coords', params: [0, 0, 1, 0, 0, 5] })
    const sketch = features[0] as SketchFeature
    expect(sketch.sketch.constraints).toMatchObject([{ kind: 'diameter', value: 20, entity: 1 }])
    const builder = new Builder(kernel)
    const build = () => {
      const steps = resolveFeatures(features, { sections: [], elements: [], modelCenter: [0, 0, 0] }, f => findRegions(f.sketch))
      const result = builder.build(steps, id => id === sketch.id ? sketch.sketch : undefined, true)
      expect(result.results.every(r => r.status === 'ok')).toBe(true)
      return kernel.volume(builder.body(features[1].id)!)
    }
    expect(build()).toBeCloseTo(Math.PI * 100 * 12, 5)
    const constraint = sketch.sketch.constraints[0]
    if (constraint.kind !== 'diameter') throw Error('Expected imported driving diameter')
    constraint.value = 18
    expect(solveSketch(sketch.sketch).ok).toBe(true)
    expect(build()).toBeCloseTo(Math.PI * 81 * 12, 5)
    const native18 = await readQsfProject(readFileSync(new URL('cylinder-regenerated18.qsf', nativeRoot)), 'cylinder-regenerated18.qsf')
    const nativeSketch = ((native18.manifest.reverse as ReversePart).features[0] as SketchFeature).sketch
    const editedCircle = sketch.sketch.entities[0]
    expect(editedCircle.kind).toBe('circle')
    if (editedCircle.kind === 'circle') expect(editedCircle.r).toBeCloseTo(9, 8)
    expect(nativeSketch.entities[0]).toMatchObject({ kind: 'circle', r: 9 })
    expect(nativeSketch.constraints[0]).toMatchObject({ kind: 'diameter', value: 18 })
    builder.dispose()
  }, 120_000)
})

describe('owned native three-sketch project', () => {
  it.each([true, false])('preserves section frames, native visibility (%s), coincidence and save/reopen data', async visible => {
    const bytes = readFileSync(new URL('preserved-three-sketches.qsf', nativeRoot))
    const first = readQsfContainer(bytes).records.find(r => r.type === 16)!
    new DataView(first.bytes.buffer, first.bytes.byteOffset).setUint32(32, visible ? 1 : 0, true)
    expect(inspectQsfProject(bytes, 'native-visible.qsf').supported).toBe(true)
    const imported = await readQsfProject(bytes, 'native-visible.qsf')
    const roundtrip = unpackProject(packProject(imported.manifest, [...imported.members].map(([name, bytes]) => ({ name, bytes }))))
    const features = (roundtrip.manifest.reverse as ReversePart).features as SketchFeature[]
    expect(features.map(f => [f.kind, f.name])).toEqual([['sketch', 'Sketch(1)'], ['sketch', 'Sketch(2)'], ['sketch', 'Sketch(3)']])
    expect(features.map(f => f.visible)).toEqual([visible, true, true])
    expect(features.map(f => f.sketch.entities.length)).toEqual([0, 0, 2])
    expect(features[0].sketch.referenceChains?.flat()).toHaveLength(321)
    expect(features[1].frame).toEqual({ origin: [2, 0, 0], normal: [1, 0, 0], basisU: [0, 1, 0], basisV: [0, 0, 1] })
    const refs = features[1].sketch.referenceChains!.flat()
    expect(refs).toHaveLength(145)
    const nativeSecond = readQsfContainer(bytes).records.filter(r => r.type === 16)[1]
    const nativeWorld = decodeQsfSketch(nativeSecond.bytes).references.flatMap(r => r.points)
    refs.forEach((p, i) => { expect(nativeWorld[3 * i]).toBe(2); expect(p).toEqual([nativeWorld[3 * i + 1], nativeWorld[3 * i + 2]]) })
    const sketch = features[2].sketch
    expect(sketch.constraints).toEqual([{ id: 3, kind: 'coincident', p: { entity: 1, at: 'a' }, q: { entity: 2, at: 'a' } }])
    const target: [number, number] = [19.165285992257076, 7.290308986975477]
    expect(solveSketch(sketch, { pull: [{ anchor: { entity: 1, at: 'a' }, to: target }] }).ok).toBe(true)
    const [a, b] = sketch.entities
    if (a.kind !== 'line' || b.kind !== 'line') throw Error('Expected imported lines')
    expect(Math.hypot(a.a[0] - b.a[0], a.a[1] - b.a[1])).toBeLessThan(1e-9)
    expect(Math.hypot(a.a[0] - target[0], a.a[1] - target[1])).toBeLessThan(2e-5)
    expect(roundtrip.members.get(QSF_SOURCE_MEMBER)).toEqual(Uint8Array.from(bytes))
  })
  it('rejects a changed native coincidence mode without replacing the open session', async () => {
    const bytes = readFileSync(new URL('preserved-three-sketches.qsf', nativeRoot))
    const third = readQsfContainer(bytes).records.filter(r => r.type === 16)[2]
    const raw = decodeQsfSketch(third.bytes).constraints[0].raw
    const offset = third.bytes.findIndex((_, i) => i + raw.length <= third.bytes.length && raw.every((b, j) => b === third.bytes[i + j]))
    expect(offset).toBeGreaterThan(0)
    third.bytes[offset + 62] ^= 1
    const before = useReverse.getState()
    expect(inspectQsfProject(bytes, 'changed-coincidence.qsf').supported).toBe(false)
    await expect(readQsfProject(bytes, 'changed-coincidence.qsf')).rejects.toThrow('Constraint metadata mapping is not verified')
    expect(useReverse.getState()).toBe(before)
  })
})
