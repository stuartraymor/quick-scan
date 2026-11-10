// SPDX-License-Identifier: AGPL-3.0-only
// Atomic, deliberately narrow QSF conversion. Retaining source bytes does not
// make unsupported native geometry or history editable.
import { blankManifest } from '../../../src/app/project'
import type { ProjectSection } from '../../../src/app/projectSections'
import { onScan } from '../../../src/app/scanEvents'
import type { UnpackedProject } from '../../../src/core/project/archive'
import { validateManifest } from '../../../src/core/project/manifest'
import { evaluateConstruction } from '../../../src/core/elements/construct'
import { useStore } from '../../../src/state/store'
import { APP_VERSION } from '../../../src/version'
import { readQsfContainer, decodeQsfMesh, validateQsfMeshState, validateQsfEmptyAuxiliary, type QsfRecord } from '../core/qsfContainer'
import { decodeQsfSketch, isVerifiedQsfDrivingDiameter, isVerifiedQsfCoincidentEndpoints } from '../core/qsfSketch'
import { decodeQsfExtrude } from '../core/qsfExtrude'
import { decodeQsfPlane } from '../core/qsfPlane'
import type { Feature, SketchFeature } from '../core/features'
import type { Sketch, SketchEntity } from '../core/sketch'
import { findRegions } from '../core/regions'
import { PART_VERSION, featureToJson, validateFeatureJson, type ReversePart } from './projectSection'

export const QSF_SOURCE_MEMBER = 'source-project.qsf'
interface QsfSource { version: 1; member: typeof QSF_SOURCE_MEMBER; fileName: string }
let archivedSource: { value: QsfSource; bytes: Uint8Array } | undefined
const changes = new Set<() => void>()
const changed = () => { for (const fn of changes) fn() }
onScan({ loaded() { if (archivedSource) { archivedSource = undefined; changed() } } })
export const qsfSourceSection: ProjectSection<QsfSource> = {
  key: 'qsfSource',
  members: value => [value.member],
  collect(ctx) {
    if (!ctx.scanSaved || !archivedSource) return undefined
    ctx.addMember(QSF_SOURCE_MEMBER, Uint8Array.from(archivedSource.bytes))
    return { ...archivedSource.value }
  },
  prepare(value, ctx) {
    if (value === undefined) return () => { archivedSource = undefined; changed() }
    if (!value || typeof value !== 'object') throw Error('Malformed QSF source provenance.')
    const v = value as Partial<QsfSource>
    if (v.version !== 1 || v.member !== QSF_SOURCE_MEMBER || typeof v.fileName !== 'string' || !v.fileName || v.fileName.length > 4096) throw Error('Malformed QSF source provenance.')
    const bytes = ctx.members.get(QSF_SOURCE_MEMBER)
    if (!bytes) throw Error('The archived QSF source is missing.')
    readQsfContainer(bytes)
    const prepared = { value: { version: 1, member: QSF_SOURCE_MEMBER, fileName: v.fileName } as QsfSource, bytes: Uint8Array.from(bytes) }
    return () => { archivedSource = prepared; changed() }
  },
  watch(fn) { changes.add(fn); return () => { changes.delete(fn) } },
}

export interface QsfInspection {
  name: string
  supported: boolean
  notes: string[]
  records: { index: number; type: number; supported: boolean; reason?: string }[]
}
export class QsfProjectUnsupportedError extends Error {
  constructor(readonly report: QsfInspection) {
    const failures = report.records.filter(r => !r.supported)
    super(`QSF project cannot be opened without losing editable data: ${failures.slice(0, 8).map(r => `record ${r.index} (type ${r.type}): ${(r.reason ?? 'Unsupported data').slice(0, 180)}`).join('; ') || 'Exactly one supported scan is required'}${failures.length > 8 ? `; and ${failures.length - 8} more unsupported records` : ''}. The current project was not changed.`)
  }
}
const guid = (r: QsfRecord) => Array.from(r.bytes.subarray(12, 28), b => b.toString(16).padStart(2, '0')).join('')
function verifiedObjectHeader(r: QsfRecord) {
  const fields: Record<number, Record<number, number>> = {
    8: { 28: 0x007b694a, 32: 0x10001, 112: 0x10001 },
    16: { 28: 0x0052472e, 104: 0x01010100, 108: 0x10101, 112: 0x10001 },
    17: { 28: 0x007b694a, 32: 1, 112: 0x10003 },
  }
  if (r.bytes.length < 120) throw Error('Truncated object header')
  const v = new DataView(r.bytes.buffer, r.bytes.byteOffset, r.bytes.byteLength)
  if (v.getUint32(8, true) !== 0) throw Error('Unverified object header state')
  for (let offset = 28; offset < 120; offset += 4) {
    if (r.type === 16 && offset === 32 && v.getUint32(offset, true) <= 1) continue
    if (v.getUint32(offset, true) !== (fields[r.type][offset] ?? 0)) throw Error('Unverified object pose/display header variant')
  }
}
function sketchFeature(s: ReturnType<typeof decodeQsfSketch>, id: number): SketchFeature {
  if (!s.frame.supported || s.entities.some(e => e.kind === 'arc')) throw Error(s.limitations.join('; ') || 'Unverified sketch settings')
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]
  if (s.entities.some(e => e.transform.some((x, i) => Math.abs(x - identity[i]) > 1e-12))) throw Error('Entity-local transform is not verified')
  const { origin, normal, basisU, basisV } = s.frame
  const frame = { origin, normal, basisU, basisV }
  // Only the empty rotated section has been independently calibrated so far.
  if (s.entities.length && s.frame.transform.some((x, i) => ![3, 7, 11].includes(i) && Math.abs(x - identity[i]) > 1e-12)) throw Error('Populated rotated sketch conversion is not verified')
  const entities: SketchEntity[] = s.entities.map((e, i) => {
    if (e.kind === 'line') {
      if (Math.abs(e.points[2]) > 1e-9 || Math.abs(e.points[5]) > 1e-9) throw Error('Nonplanar sketch line')
      return { id: i + 1, kind: 'line', a: [e.points[0], e.points[1]], b: [e.points[3], e.points[4]] }
    }
    if (e.kind === 'circle' && e.center && e.radius) {
      if (Math.abs(e.center[2]) > 1e-9) throw Error('Nonplanar sketch circle')
      return { id: i + 1, kind: 'circle', c: [e.center[0], e.center[1]], r: e.radius }
    }
    throw Error('Unverified sketch entity conversion')
  })
  const constraints = s.constraints.map((c, index) => {
    if (s.constraints.length === 1 && isVerifiedQsfCoincidentEndpoints(c, s.entities)) {
      return { id: entities.length + index + 1, kind: 'coincident' as const,
        p: { entity: entities[0].id, at: 'a' as const }, q: { entity: entities[1].id, at: 'a' as const } }
    }
    const entity = entities[c.entityIndices[0]]
    if (!isVerifiedQsfDrivingDiameter(c) || entity?.kind !== 'circle' || Math.abs(entity.r - c.value) > 1e-8) throw Error('Constraint metadata mapping is not verified')
    return { id: entities.length + index + 1, kind: 'diameter' as const, entity: entity.id, value: 2 * c.value }
  })
  const referenceChains: [number, number][][] = s.references.map(r => {
    const points: [number, number][] = []
    for (let i = 0; i < r.points.length; i += 3) {
      const delta = [r.points[i] - origin[0], r.points[i + 1] - origin[1], r.points[i + 2] - origin[2]]
      const dot = (axis: readonly number[]) => delta.reduce((sum, x, j) => sum + x * axis[j], 0)
      if (Math.abs(dot(normal)) > 1e-4) throw Error('Reference chain is not on the sketch plane')
      points.push([dot(basisU), dot(basisV)])
    }
    return points
  })
  const sketch: Sketch = { entities, constraints, nextId: entities.length + constraints.length + 1, referenceChains }
  return { id, kind: 'sketch', name: s.name, plane: { kind: 'fitted', frame }, frame, sketch, visible: s.visible }
}

function prepare(bytes: Uint8Array, name: string) {
  if (bytes.byteLength > 128 * 1024 * 1024) throw Error('QSF conversion exceeds the 128 MiB limit.')
  const container = readQsfContainer(bytes)
  if (container.records.length > 4096) throw Error('QSF conversion exceeds the 4096-record limit.')
  const report: QsfInspection = { name, supported: true, records: [], notes: [] }
  const planes: ReturnType<typeof decodeQsfPlane>[] = []
  const features: Feature[] = [], sketches = new Map<string, { source: ReturnType<typeof decodeQsfSketch>; feature: SketchFeature }>()
  const featureOrder = new Map<number, number>()
  const consumed = new Set<number>()
  const objectGuids = new Set<string>()
  const reject = (index: number, reason: string) => { report.records.push({ index, type: container.records[index].type, supported: false, reason }); report.supported = false }
  const meshes = container.records.filter(r => r.type === 4)
  let mesh: ReturnType<typeof decodeQsfMesh> | undefined
  let meshGuid: string | undefined
  if (meshes.length === 1) {
    try { meshGuid = validateQsfMeshState(meshes[0].bytes).guid } catch { /* Specific error is captured per record below. */ }
  }
  for (let i = 0; i < container.records.length; i++) {
    const r = container.records[i]
    try {
      if ([4, 8, 16, 17].includes(r.type)) {
        const identity = guid(r)
        if (identity.length !== 32 || /^0+$/.test(identity) || objectGuids.has(identity)) throw Error('Invalid or duplicate native object identity')
        objectGuids.add(identity)
      }
      if (r.type === 4) {
        if (meshes.length !== 1) throw Error('Exactly one scan mesh is supported')
        validateQsfMeshState(r.bytes)
        mesh = decodeQsfMesh(r.bytes)
        if (mesh.positions.length < 9 || mesh.triangles.length < 3) throw Error('Empty scan geometry is unsupported')
        if (mesh.positions.length > 3_000_000 || mesh.triangles.length > 6_000_000) throw Error('QSF conversion exceeds the scan vertex/triangle limit')
        consumed.add(i)
      }
      if (r.type === 21 || r.type === 22) {
        if (!meshGuid) throw Error('Project metadata has no verified scan identity')
        validateQsfEmptyAuxiliary(r, meshGuid)
        consumed.add(i)
      }
      if (r.type === 16) {
        verifiedObjectHeader(r)
        const source = decodeQsfSketch(r.bytes), feature = sketchFeature(source, features.length + 1)
        if (sketches.has(source.guid)) throw Error('Duplicate sketch identity')
        sketches.set(source.guid, { source, feature }); features.push(feature); featureOrder.set(feature.id, i); consumed.add(i)
      }
      if (r.type === 8) {
        verifiedObjectHeader(r)
        planes.push(decodeQsfPlane(r.bytes)); consumed.add(i)
        if (!report.notes.length) report.notes.push('Plane display size uses Quick Scan presentation; original display metadata retained.')
      }
    } catch (e) { reject(i, (e as Error).message); consumed.add(i) }
  }
  for (let i = 0; i < container.records.length; i++) {
    const r = container.records[i]
    if (consumed.has(i)) continue
    try {
      if (r.type !== 17) continue
      verifiedObjectHeader(r)
      const ownGuid = guid(r), metadata = container.records.map((x, index) => ({ x, index })).filter(({ x }) => x.type === 62 && guid(x) === ownGuid)
      const cache = container.records.map((x, index) => ({ x, index })).filter(({ x }) => x.type === 48 && guid(x) === ownGuid)
      if (metadata.length !== 1 || cache.length > 1) throw Error('Missing or ambiguous extrusion metadata/cache')
      if (consumed.has(metadata[0].index) || (cache[0] && consumed.has(cache[0].index))) throw Error('Extrusion cache or metadata is shared ambiguously')
      const dependency = [...sketches.values()].filter(s => s.source.links.includes(ownGuid))
      if (dependency.length !== 1) throw Error('Missing or ambiguous editable extrusion sketch')
      const s = dependency[0], ex = decodeQsfExtrude(r.bytes, metadata[0].x.bytes, s.source, cache[0]?.x.bytes)
      if (featureOrder.get(s.feature.id)! >= i) throw Error('Extrusion references a sketch later in native history')
      const regions = findRegions(s.feature.sketch)
      if (regions.length !== 1) throw Error('Only one verified closed extrusion profile is supported')
      features.push({ id: features.length + 1, kind: 'extrude', name: ex.name, sketchId: s.feature.id, regions: regions.map(x => x.key), extent: { kind: 'distance', from: 0, to: ex.depth }, op: 'new', visible: true })
      featureOrder.set(features[features.length - 1].id, i)
      consumed.add(i); consumed.add(metadata[0].index); if (cache[0]) consumed.add(cache[0].index)
    } catch (e) { reject(i, (e as Error).message); consumed.add(i) }
  }
  for (const s of sketches.values()) {
    if (s.source.links.some(link => !container.records.some((r, index) => r.type === 17 && consumed.has(index) && guid(r) === link && !report.records.some(x => x.index === index && !x.supported)))) {
      const index = container.records.findIndex(r => r.type === 16 && guid(r) === s.source.guid)
      reject(index, 'Sketch has an unresolved native dependency')
    }
  }
  for (let i = 0; i < container.records.length; i++) {
    if (consumed.has(i)) continue
    reject(i, 'Unverified feature or project metadata; source retention does not preserve its editable meaning')
  }
  for (let i = 0; i < container.records.length; i++) if (!report.records.some(r => r.index === i)) report.records.push({ index: i, type: container.records[i].type, supported: true })
  report.records.sort((a, b) => a.index - b.index)
  if (!mesh || meshes.length !== 1) report.supported = false
  features.sort((a, b) => featureOrder.get(a.id)! - featureOrder.get(b.id)!)
  return { report, mesh, features, planes }
}

export function inspectQsfProject(bytes: Uint8Array, name: string): QsfInspection { return prepare(bytes, name).report }

export async function readQsfProject(bytes: Uint8Array, name: string): Promise<UnpackedProject> {
  const { report, mesh, features, planes } = prepare(bytes, name)
  if (!report.supported || !mesh) throw new QsfProjectUnsupportedError(report)
  const manifest = blankManifest(APP_VERSION), defaults = useStore.getInitialState()
  manifest.name = name.replace(/^.*[\\/]/, '').replace(/\.qsf$/i, '') || 'Imported QSF'
  manifest.workspace = 'reverse'
  const obj = ['# QSF scan geometry']
  for (let i = 0; i < mesh.positions.length; i += 3) obj.push(`v ${mesh.positions[i]} ${mesh.positions[i + 1]} ${mesh.positions[i + 2]}`)
  for (let i = 0; i < mesh.triangles.length; i += 3) obj.push(`f ${mesh.triangles[i] + 1} ${mesh.triangles[i + 1] + 1} ${mesh.triangles[i + 2] + 1}`)
  manifest.scan = { fileName: `${mesh.name || 'Scan'}.obj`, member: 'scan.obj', appliedAlignment: null, elements: [], dimensions: [], nextId: 1, nextNumber: 1, nextOfKind: {}, nextDimensionId: 1, nextOfDimGroup: {}, settings: { ...defaults.settings }, selectMode: defaults.selectMode, showOverlays: defaults.showLabels }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < mesh.positions.length; i++) { min[i % 3] = Math.min(min[i % 3], mesh.positions[i]); max[i % 3] = Math.max(max[i % 3], mesh.positions[i]) }
  const modelSize = Math.hypot(...min.map((x, i) => max[i] - x)) / 2
  manifest.scan.elements = planes.map((p, i) => {
    const params = [...p.normal, ...p.origin]
    return { id: i + 1, kind: 'plane', name: p.name, color: '#66bbff', status: 'done', visible: true, source: { type: 'constructed', method: 'plane-coords', refs: [], params }, fit: evaluateConstruction('plane-coords', [], params, modelSize) }
  })
  manifest.scan.nextId = planes.length + 1; manifest.scan.nextNumber = planes.length + 1; manifest.scan.nextOfKind = { plane: planes.length + 1 }
  for (const f of features) validateFeatureJson(f as unknown as Record<string, unknown>)
  manifest.reverse = { version: PART_VERSION, features: features.map(featureToJson), nextFeatureId: features.length + 1, nextOfKind: { sketch: features.filter(f => f.kind === 'sketch').length + 1, extrude: features.filter(f => f.kind === 'extrude').length + 1 }, elementsShown: true } satisfies ReversePart
  manifest.qsfSource = { version: 1, member: QSF_SOURCE_MEMBER, fileName: name } satisfies QsfSource
  validateManifest(manifest)
  return { manifest, members: new Map([['scan.obj', new TextEncoder().encode(obj.join('\n') + '\n')], [QSF_SOURCE_MEMBER, Uint8Array.from(bytes)]]) }
}
