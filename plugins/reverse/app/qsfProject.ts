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
import { elementColor } from '../../../src/state/elementModel'
import { APP_VERSION } from '../../../src/version'
import { readQsfContainer, decodeQsfMesh, validateQsfMeshState, validateQsfEmptyAuxiliary, type QsfRecord } from '../core/qsfContainer'
import { decodeQsfSketch } from '../core/qsfSketch'
import { decodeQsfExtrude } from '../core/qsfExtrude'
import { decodeQsfPlane } from '../core/qsfPlane'
import { decodeQsfPrimitive, isQsfPrimitiveType, type QsfPrimitive } from '../core/qsfPrimitive'
import { decodeQsfSurface } from '../core/qsfSurface'
import { decodeQsfFitSurface } from '../core/qsfFitSurface'
import { DEFAULT_SURFACE_FIT } from '../core/surfaceFit'
import type { Feature, SketchFeature } from '../core/features'
import { splineAnchor, type AnchorAt, type Sketch, type SketchEntity } from '../core/sketch'
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
    // Snapshot identity tracks member bytes. This owned, immutable copy must
    // stay stable between captures or every successful Save appears dirty.
    ctx.addMember(QSF_SOURCE_MEMBER, archivedSource.bytes)
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
  /** Native relations left out of sketches that did come across. */
  dropped: string[]
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
    // Fitted primitives (cylinder 10, sphere 11, cone 23), as all 42 read so far.
    10: { 28: 0x007b694a, 32: 0x10001, 116: 1 },
    11: { 28: 0x007b694a, 32: 0x10001 },
    23: { 28: 0x007b694a, 32: 0x10001, 116: 1 },
  }
  if (r.bytes.length < 120) throw Error('Truncated object header')
  const v = new DataView(r.bytes.buffer, r.bytes.byteOffset, r.bytes.byteLength)
  if (v.getUint32(8, true) !== 0) throw Error('Unverified object header state')
  for (let offset = 28; offset < 120; offset += 4) {
    if (r.type === 16 && offset === 32 && v.getUint32(offset, true) <= 1) continue
    // A plane's shown/hidden flag (decodeQsfPlane reads it).
    if ([8, 10, 11, 23].includes(r.type) && offset === 32 && (v.getUint32(offset, true) & ~1) === 0x10000) continue
    if (v.getUint32(offset, true) !== (fields[r.type][offset] ?? 0)) throw Error('Unverified object pose/display header variant')
  }
}
/** A native constraint as Quick Scan's, when the sketch as QUICKSURFACE
 *  saved it already satisfies it — the drawing is solved, so a relation read
 *  the right way holds on it to rounding. One that does not hold, or whose
 *  pieces are not lines and circles as read, is left out (and said): read
 *  the wrong way it would move the drawing the first time it is solved. */
function nativeConstraint(c: ReturnType<typeof decodeQsfSketch>['constraints'][number], entities: SketchEntity[], id: number): Sketch['constraints'][number] | null {
  const [ea, eb] = c.entityIndices.map(i => entities[i])
  const [pa, pb] = c.pointIndices
  const size = Math.max(1, ...entities.flatMap(e => e.kind === 'line' ? [...e.a, ...e.b].map(Math.abs) : e.kind === 'circle' ? [...e.c.map(Math.abs), e.r] : []))
  const tol = 1e-6 * size
  // A point as the native point selector names it: a line's start (0) or
  // end (1), a spline's control point by its index (0 and the last are its
  // ends — a clamped curve passes through both).
  const end = (e: SketchEntity | undefined, at: number): [number, number] | null =>
    e?.kind === 'line' ? (at === 0 ? e.a : at === 1 ? e.b : null) : e?.kind === 'spline' && e.controlKnots ? (e.pts[at] ?? null) : null
  const anchor = (e: SketchEntity, n: number): AnchorAt => e.kind === 'spline' ? splineAnchor(e, n) : n === 0 ? 'a' : 'b'
  switch (c.semantic) {
    case 'coincident': {
      const p = end(ea, pa), q = end(eb, pb)
      if (!p || !q || ea === eb || Math.hypot(p[0] - q[0], p[1] - q[1]) > tol) return null
      return { id, kind: 'coincident', p: { entity: ea.id, at: anchor(ea, pa) }, q: { entity: eb.id, at: anchor(eb, pb) } }
    }
    case 'horizontal':
    case 'vertical': {
      if (ea?.kind !== 'line' || (eb && eb !== ea)) return null
      const off = c.semantic === 'horizontal' ? Math.abs(ea.a[1] - ea.b[1]) : Math.abs(ea.a[0] - ea.b[0])
      return off <= tol ? { id, kind: c.semantic, entity: ea.id } : null
    }
    case 'distance': {
      // A line's length: its two ends, one line.
      if (ea?.kind === 'line' && ea === eb && pa !== pb && (pa === 0 || pa === 1) && (pb === 0 || pb === 1) && c.value > 0 &&
        Math.abs(Math.hypot(ea.b[0] - ea.a[0], ea.b[1] - ea.a[1]) - c.value) <= tol) return { id, kind: 'length', entity: ea.id, value: c.value }
      const p = end(ea, pa), q = end(eb, pb)
      if (p && q && ea !== eb && c.value > 0 && Math.abs(Math.hypot(p[0] - q[0], p[1] - q[1]) - c.value) <= tol) return { id, kind: 'distance', p: { entity: ea.id, at: anchor(ea, pa) }, q: { entity: eb.id, at: anchor(eb, pb) }, value: c.value }
      return null
    }
    case 'pointOn': {
      // A point on a line: held on it, as drawn.
      const p = end(ea, pa)
      if (!p || eb?.kind !== 'line' || ea === eb) return null
      const [dx, dy] = [eb.b[0] - eb.a[0], eb.b[1] - eb.a[1]], len = Math.hypot(dx, dy)
      if (!(len > 0) || Math.abs((p[0] - eb.a[0]) * dy - (p[1] - eb.a[1]) * dx) / len > tol) return null
      return { id, kind: 'pointOn', p: { entity: ea.id, at: anchor(ea, pa) }, on: { line: eb.id } }
    }
    case 'radius': {
      if (ea?.kind !== 'circle' || !(c.value > 0) || Math.abs(ea.r - c.value) > tol) return null
      return { id, kind: 'diameter', entity: ea.id, value: 2 * c.value }
    }
    default:
      return null
  }
}

function sketchFeature(s: ReturnType<typeof decodeQsfSketch>, id: number, dropped: string[] = []): SketchFeature {
  if (s.entities.some(e => e.kind === 'arc')) throw Error(s.limitations.join('; ') || 'Unverified sketch settings')
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]
  const same = (a: readonly number[], b: readonly number[]) => a.every((x, i) => Math.abs(x - b[i]) <= 1e-12)
  // A sketch on a tilted plane: the frame's columns are its x, y and normal
  // in the world, and its pieces are in that frame — each piece carries the
  // frame again, not a transform of its own. Read so, the lines Fit Line
  // made on the rear plane of mixed-part's basic part lie on the section
  // they were fitted to (467 and 656 of its points within 0.1 mm; mirrored,
  // none). The section, in world coordinates, must lie on the plane the
  // frame says (checked below), or the sketch is not read.
  if (s.entities.some(e => !same(e.transform, identity) && !same(e.transform, s.frame.transform))) throw Error('Entity-local transform is not verified')
  const { origin, normal, basisU, basisV } = s.frame
  const frame = { origin, normal, basisU, basisV }
  if (!s.frame.supported) {
    const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    const cross = [basisU[1] * basisV[2] - basisU[2] * basisV[1], basisU[2] * basisV[0] - basisU[0] * basisV[2], basisU[0] * basisV[1] - basisU[1] * basisV[0]]
    const orthonormal = [basisU, basisV, normal].every(a => Math.abs(dot(a, a) - 1) <= 1e-9) && Math.abs(dot(basisU, basisV)) <= 1e-9 && cross.every((x, i) => Math.abs(x - normal[i]) <= 1e-9)
    const onPlane = s.references.reduce((n, r) => n + r.points.length / 3, 0) >= 3
    if (!orthonormal || !onPlane || s.references.some(r => !same(r.transform, identity) && !same(r.transform, s.frame.transform))) throw Error('Rotated frame convention is not verified')
  }
  const entities: SketchEntity[] = s.entities.map((e, i) => {
    if (e.kind === 'line') {
      if (Math.abs(e.points[2]) > 1e-9 || Math.abs(e.points[5]) > 1e-9) throw Error('Nonplanar sketch line')
      return { id: i + 1, kind: 'line', a: [e.points[0], e.points[1]], b: [e.points[3], e.points[4]] }
    }
    if (e.kind === 'circle' && e.center && e.radius) {
      if (Math.abs(e.center[2]) > 1e-9) throw Error('Nonplanar sketch circle')
      return { id: i + 1, kind: 'circle', c: [e.center[0], e.center[1]], r: e.radius }
    }
    if (e.kind === 'spline' && e.poles && e.knots) {
      // QUICKSURFACE's fitted curve as Quick Scan's own control-point
      // spline: the same poles, the same uniform clamped cubic knots.
      if (e.poles.some((x, k) => k % 3 === 2 && Math.abs(x) > 1e-6)) throw Error('A 3D curve is not a sketch Quick Scan can hold')
      const pts: [number, number][] = []
      for (let k = 0; k < e.poles.length; k += 3) pts.push([e.poles[k], e.poles[k + 1]])
      const controlKnots = [...e.knots]
      return { id: i + 1, kind: 'spline', pts, controlKnots }
    }
    throw Error('Unverified sketch entity conversion')
  })
  const flagged = s.pieceFlags.filter(x => x === 1).length
  if (flagged) dropped.push(`${s.name}: a QuickSurface setting on ${flagged === 1 ? 'one piece' : `${flagged} pieces`}, not read yet (the pieces come across as drawn)`)
  const constraints: Sketch['constraints'] = []
  for (const c of s.constraints) {
    const made = nativeConstraint(c, entities, entities.length + constraints.length + 1)
    if (made) constraints.push(made)
    else dropped.push(c.semantic === 'other' ? `${s.name}: a relation of a kind not read yet (native type ${c.nativeType})` : `${s.name}: a ${c.semantic} relation`)
  }
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

/** For each point, the nearest scan vertex — through a grid of cells, each
 *  point looking in its own cell and the 26 round it, then further out
 *  until one is found; every vertex once, in order. */
function nearestVertices(positions: Float32Array, points: Float32Array): Uint32Array {
  const n = positions.length / 3
  if (n === 0) return new Uint32Array(0)
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i++) { min[i % 3] = Math.min(min[i % 3], positions[i]); max[i % 3] = Math.max(max[i % 3], positions[i]) }
  const span = Math.max(1e-6, ...max.map((x, i) => x - min[i]))
  const cell = Math.max(span / 256, 1e-3)
  const key = (x: number, y: number, z: number) => `${Math.floor((x - min[0]) / cell)},${Math.floor((y - min[1]) / cell)},${Math.floor((z - min[2]) / cell)}`
  const grid = new Map<string, number[]>()
  for (let i = 0; i < n; i++) { const k = key(positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]); const c = grid.get(k); if (c) c.push(i); else grid.set(k, [i]) }
  const picked = new Set<number>()
  for (let p = 0; p < points.length; p += 3) {
    const [x, y, z] = [points[p], points[p + 1], points[p + 2]]
    const [cx, cy, cz] = [Math.floor((x - min[0]) / cell), Math.floor((y - min[1]) / cell), Math.floor((z - min[2]) / cell)]
    let best = -1, bestD = Infinity
    for (let reach = 1; reach <= 4 && best < 0; reach++) {
      for (let a = -reach; a <= reach; a++) for (let b = -reach; b <= reach; b++) for (let c = -reach; c <= reach; c++) {
        for (const i of grid.get(`${cx + a},${cy + b},${cz + c}`) ?? []) {
          const d = (positions[3 * i] - x) ** 2 + (positions[3 * i + 1] - y) ** 2 + (positions[3 * i + 2] - z) ** 2
          if (d < bestD) { bestD = d; best = i }
        }
      }
    }
    if (best >= 0) picked.add(best)
  }
  return Uint32Array.from([...picked].sort((a, b) => a - b))
}

function prepare(bytes: Uint8Array, name: string) {
  if (bytes.byteLength > 128 * 1024 * 1024) throw Error('QSF conversion exceeds the 128 MiB limit.')
  const container = readQsfContainer(bytes)
  if (container.records.length > 4096) throw Error('QSF conversion exceeds the 4096-record limit.')
  const report: QsfInspection = { name, supported: true, records: [], notes: [], dropped: [] }
  const planes: ReturnType<typeof decodeQsfPlane>[] = []
  const primitives: QsfPrimitive[] = []
  const features: Feature[] = [], sketches = new Map<string, { source: ReturnType<typeof decodeQsfSketch>; feature: SketchFeature }>()
  const featureOrder = new Map<number, number>()
  const consumed = new Set<number>()
  const objectGuids = new Set<string>()
  const reject = (index: number, reason: string) => { report.records.push({ index, type: container.records[index].type, supported: false, reason }); report.supported = false }
  const meshes = container.records.filter(r => r.type === 4)
  let mesh: ReturnType<typeof decodeQsfMesh> | undefined
  let meshGuid: string | undefined
  // The scan is the first mesh read whole; Quick Scan holds one, so any
  // other is left out (and said).
  for (const m of meshes) {
    try { meshGuid = validateQsfMeshState(m.bytes).guid; break } catch { /* Specific error is captured per record below. */ }
  }
  for (let i = 0; i < container.records.length; i++) {
    const r = container.records[i]
    try {
      if ([4, 8, 10, 11, 16, 17, 23].includes(r.type)) {
        const identity = guid(r)
        if (identity.length !== 32 || /^0+$/.test(identity) || objectGuids.has(identity)) throw Error('Invalid or duplicate native object identity')
        objectGuids.add(identity)
      }
      if (r.type === 4) {
        validateQsfMeshState(r.bytes)
        if (guid(r) !== meshGuid) throw Error('Quick Scan opens one scan mesh; this is another')
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
        const source = decodeQsfSketch(r.bytes), dropped: string[] = [], feature = sketchFeature(source, features.length + 1, dropped)
        if (sketches.has(source.guid)) throw Error('Duplicate sketch identity')
        sketches.set(source.guid, { source, feature }); features.push(feature); featureOrder.set(feature.id, i); consumed.add(i)
        report.dropped.push(...dropped)
      }
      if (isQsfPrimitiveType(r.type)) {
        verifiedObjectHeader(r)
        primitives.push(decodeQsfPrimitive(r.type, r.bytes)); consumed.add(i)
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
  // Freeform cages (type 7) and Fit Surfaces (type 25), each a feature in
  // its place in native order.
  for (let i = 0; i < container.records.length; i++) {
    const r = container.records[i]
    if (consumed.has(i) || (r.type !== 7 && r.type !== 25)) continue
    try {
      const id = features.length + 1
      if (r.type === 7) {
        // A subdivision cage: its points (world coordinates — QUICKSURFACE's
        // own quad OBJ export of Freeform(2) and (3) has them to 1e-13 mm)
        // and quads. Refined three times, as From quad OBJ does; not snapped,
        // so the surface is the cage's own, as QUICKSURFACE saved it.
        const c = decodeQsfSurface(r.bytes)
        features.push({ id, kind: 'freeform', name: c.name, positions: Array.from(c.vertices), faces: c.quads.map(q => [...q]), creases: [], steps: 3, snap: false, visible: c.visible })
      } else {
        if (!mesh) throw Error('A Fit Surface needs the scan it was fitted on')
        // QUICKSURFACE's fitted surface itself, its control net held so
        // nothing is fitted again; the region is the scan's vertices nearest
        // the points it was fitted to (those lie on the scan's triangles).
        const s = decodeQsfFitSurface(r.bytes)
        features.push({ id, kind: 'surface', name: s.name, region: nearestVertices(mesh.positions, s.points), fit: { ...DEFAULT_SURFACE_FIT, net: s.net, degree: s.surface.u.degree }, controlSurface: s.surface, shape: 'freeform', visible: s.visible })
      }
      featureOrder.set(id, i); consumed.add(i)
    } catch (e) { reject(i, (e as Error).message); consumed.add(i) }
  }
  for (const s of sketches.values()) {
    if (s.source.links.some(link => !container.records.some((r, index) => r.type === 17 && consumed.has(index) && guid(r) === link && !report.records.some(x => x.index === index && !x.supported)))) {
      const index = container.records.findIndex(r => r.type === 16 && guid(r) === s.source.guid)
      // The sketch comes across as drawn; what was built on it does not.
      if (index >= 0) { report.dropped.push(`${s.feature.name}: the extrusion built on it`); report.supported = false }
    }
  }
  for (let i = 0; i < container.records.length; i++) {
    if (consumed.has(i)) continue
    reject(i, 'Unverified feature or project metadata; source retention does not preserve its editable meaning')
  }
  for (let i = 0; i < container.records.length; i++) if (!report.records.some(r => r.index === i)) report.records.push({ index: i, type: container.records[i].type, supported: true })
  report.records.sort((a, b) => a.index - b.index)
  if (!mesh) report.supported = false
  features.sort((a, b) => featureOrder.get(a.id)! - featureOrder.get(b.id)!)
  return { report, mesh, features, planes, primitives }
}

export function inspectQsfProject(bytes: Uint8Array, name: string): QsfInspection { return prepare(bytes, name).report }

/** What of a QUICKSURFACE project would not come across, in words, by kind. */
export function qsfLeftOut(report: QsfInspection): string[] {
  const words: Record<number, [string, string]> = {
    4: ['scan mesh', 'scan meshes'], 7: ['freeform curve or patch', 'freeform curves and patches'], 8: ['plane', 'planes'],
    10: ['cylinder', 'cylinders'], 11: ['sphere', 'spheres'], 16: ['sketch', 'sketches'], 17: ['extrusion', 'extrusions'],
    23: ['cone', 'cones'], 25: ['freeform surface', 'freeform surfaces'], 33: ['freeform body', 'freeform bodies'],
  }
  const counts = new Map<string, number>()
  for (const r of report.records) {
    if (r.supported) continue
    const key = words[r.type] ? r.type : -1
    counts.set(String(key), (counts.get(String(key)) ?? 0) + 1)
  }
  const out: string[] = []
  for (const [key, n] of counts) {
    const w = words[Number(key)]
    out.push(w ? `${n} ${n === 1 ? w[0] : w[1]}` : `${n} other item${n === 1 ? '' : 's'} (history, display or project data)`)
  }
  if (report.dropped.length) out.push(`${report.dropped.length} sketch relation${report.dropped.length === 1 ? '' : 's'} (the sketch comes across as drawn)`)
  return out
}

/** A QUICKSURFACE project opened as far as it can be read: its scan, and
 *  every plane, primitive, sketch and extrusion read as QUICKSURFACE has
 *  it. What is not read is said first and the person asked (`ask`); the
 *  original file goes into the saved project whole either way. Without the
 *  scan — or a yes — nothing is opened and the session stays as it was. */
export async function readQsfProject(bytes: Uint8Array, name: string, ask?: (message: string) => boolean): Promise<UnpackedProject> {
  const { report, mesh, features, planes, primitives } = prepare(bytes, name)
  if (!mesh) throw new QsfProjectUnsupportedError(report)
  const leftOut = qsfLeftOut(report)
  if (leftOut.length > 0) {
    const question = `Not all of this QuickSurface project can be brought into Quick Scan. These will not come across:\n\n- ${leftOut.join('\n- ')}\n\nOpen the rest? The scan and everything else comes across as QuickSurface has it, and the original file is kept inside the Quick Scan project when you save it.`
    if (!ask || !ask(question)) throw new QsfProjectUnsupportedError(report)
  }
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
    return { id: i + 1, kind: 'plane', name: p.name, color: '#66bbff', status: 'done', visible: p.visible, source: { type: 'constructed', method: 'plane-coords', refs: [], params }, fit: evaluateConstruction('plane-coords', [], params, modelSize) }
  })
  // The primitives QUICKSURFACE fitted, as it fitted them: what it measured
  // stands, with its fit RMS; nothing is fitted again on the scan here.
  for (const p of primitives) {
    const method = `${p.kind}-imported`
    const params = p.kind === 'cylinder' ? [...p.start, ...p.axis, p.radius, p.length, p.fitRms]
      : p.kind === 'cone' ? [...p.apex, ...p.axis, p.halfAngle, p.from, p.length, p.fitRms]
        : [...p.center, p.radius, p.fitRms]
    manifest.scan.elements.push({ id: manifest.scan.elements.length + 1, kind: p.kind, name: p.name, color: elementColor(manifest.scan.elements.length + 1), status: 'done', visible: p.visible, source: { type: 'constructed', method, refs: [], params }, fit: evaluateConstruction(method, [], params, modelSize) })
  }
  const count = (kind: string) => manifest.scan!.elements.filter(e => e.kind === kind).length + 1
  manifest.scan.nextId = manifest.scan.elements.length + 1; manifest.scan.nextNumber = manifest.scan.elements.length + 1
  manifest.scan.nextOfKind = { plane: count('plane'), ...(primitives.length ? { cylinder: count('cylinder'), sphere: count('sphere'), cone: count('cone') } : {}) }
  for (const f of features) validateFeatureJson(featureToJson(f) as unknown as Record<string, unknown>)
  // A body QUICKSURFACE saved hidden (a freeform's or a fitted surface's
  // eye shut) is put out of view: a body is named by its feature.
  const hiddenBodies = features.filter(f => (f.kind === 'freeform' || f.kind === 'surface') && !f.visible).map(f => f.id)
  manifest.reverse = { version: PART_VERSION, features: features.map(featureToJson), nextFeatureId: features.length + 1, nextOfKind: { sketch: features.filter(f => f.kind === 'sketch').length + 1, extrude: features.filter(f => f.kind === 'extrude').length + 1, freeform: features.filter(f => f.kind === 'freeform').length + 1, surface: features.filter(f => f.kind === 'surface').length + 1 }, elementsShown: true, ...(hiddenBodies.length ? { hiddenBodies } : {}) } satisfies ReversePart
  manifest.qsfSource = { version: 1, member: QSF_SOURCE_MEMBER, fileName: name } satisfies QsfSource
  validateManifest(manifest)
  return { manifest, members: new Map([['scan.obj', new TextEncoder().encode(obj.join('\n') + '\n')], [QSF_SOURCE_MEMBER, Uint8Array.from(bytes)]]) }
}
