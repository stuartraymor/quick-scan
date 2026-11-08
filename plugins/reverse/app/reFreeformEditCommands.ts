// SPDX-License-Identifier: AGPL-3.0-only
// reverse.freeform.*: a freeform cage that lives in the document (F3 of
// audit-2026-11-07/FREEFORM_ROADMAP.md). The cage is a feature of its own
// kind — the vertices, faces and creases — which the build makes a body of
// B-spline faces (core/freeform/make.ts), snapped to the scan where it is
// told to. The editor's tools (core/freeform/edit.ts) are commands here
// and not a panel: create a cage, edit it with a list of operations, move
// points with a falloff, increase its resolution, snap it to the scan, and
// set what is made of it (thickened, offset). Each change is one undo step
// of the document. The picks are indices, as reverse.freeform.read lists them.

import { invalid } from '../../../src/commands/core/common'
import { anyObject, arr, bool, enumOf, int, num, obj, str, vec3 } from '../../../src/commands/schema'
import { round3 } from '../../../src/core/round'
import type { Vec3 } from '../../../src/core/types'
import { type Command, CommandError } from '../../../src/plugins/api'
import { bounds, type Cage, faceArea, faceKinds, topology, vertexCount } from '../core/freeform/cage'
import { parseQuadObj, writeQuadObj } from '../core/freeform/cageIO'
import { addFace, addRectangle, align, boundaryLoops, bridge, closeHole, type Closest, deleteFaces, deleteVertices, deviation, extrapolate, increaseResolution, mirror, movePoints, type PointMove, setCrease, smooth, snapCage, splitLoop } from '../core/freeform/edit'
import type { FreeformAsk, FreeformData, FreeformFeature } from '../core/features'
import { MAX_STEPS } from '../core/freeform/make'
import { bodiesChanged, bodyRows } from './reCommandAnswers'
import { change, featureNamed, type Json, re, ready, type Ref, session } from './reCommandCore'
import { requireFreeName } from './reFeatureCommands'
import { scanPaths } from './reNetworkCommands'
import { featureBrief, resultOut } from './reReadout'
import { featureRef } from './reSchemas'

/** The most operations one edit takes. */
const MAX_OPS = 200
/** The most vertices and faces a read lists. */
const LIST_CAP = 5000
/** The deviation display's legend (QUICKSURFACE ±0.25 mm) and its tolerance (0.05 mm). */
const LEGEND_MM = 0.25
const TOLERANCE_MM = 0.05

// ---- the cage as the feature holds it -----------------------------------------------

function freeformNamed(ref: Ref): FreeformFeature {
  const f = featureNamed(ref)
  if (f.kind !== 'freeform') return invalid(`${f.name} is a ${f.kind}, not a freeform cage.`)
  if (!re().features.includes(f)) throw new CommandError('invalid_state', `${f.name} is below the rollback bar — move the bar (reverse.feature.rollback) to use it.`)
  return f
}

const cageOf = (f: FreeformFeature): Cage => ({ positions: Float64Array.from(f.positions), faces: f.faces.map((x) => x.slice()), creases: f.creases.map(([a, b]) => [a, b]) })

const dataOf = (c: Cage) => ({ positions: Array.from(c.positions), faces: c.faces, creases: c.creases })

function guarded<T>(what: string, job: () => T): T {
  try {
    return job()
  } catch (e) {
    return invalid(`${what}: ${(e as Error).message}`)
  }
}

/** The cage measured: counts, the open edges and holes, the bounds. */
function cageOut(c: Cage): Json {
  const t = topology(c)
  const valences = [...new Set(t.vertexEdges.map((e) => e.length))].sort((a, b) => a - b)
  const b = bounds(c)
  return {
    vertices: vertexCount(c),
    faces: c.faces.length,
    ...faceKinds(c),
    edges: t.edges.length,
    boundaryEdges: t.edges.filter((e) => e.faces.length < 2).length,
    holes: boundaryLoops(c).map((l) => l.length),
    creases: c.creases.length,
    closed: t.closed,
    valences,
    bounds: { min: b.min.map(round3), max: b.max.map(round3) },
    area: round3(faceArea(c)),
  }
}

/** What the build made of the cage: the result with its report. */
export function madeOut(f: FreeformFeature): Json {
  const r = re().results[f.id]
  const out: Json = { feature: featureBrief(f, false), result: resultOut(r) }
  const fr = r?.freeform
  if (fr) {
    const c = fr.convert
    out.body = { faces: c.faces, blocks: c.blocks, solid: c.solid, valid: c.valid, area: round3(c.area), volume: c.volume === null ? null : round3(c.volume), steps: fr.steps, ...(fr.missed ? { missed: fr.missed } : {}) }
    if (fr.shell) out.shell = { kind: fr.shell.kind, faces: fr.shell.faces, solid: fr.shell.solid, valid: fr.shell.valid, area: round3(fr.shell.area), volume: fr.shell.volume === null ? null : round3(fr.shell.volume), ...(fr.shell.side ? { side: fr.shell.side } : {}), ...(fr.shell.wall !== undefined ? { wall: round3(fr.shell.wall) } : {}) }
  }
  return out
}

/** The change put in the list, built, and told. */
async function commit(update: () => number, needsScan = false): Promise<Json> {
  const s = await ready()
  if (needsScan) await s.syncScan()
  const before = bodyRows(s)
  const id = await change(() => update())
  const f = featureNamed(id) as FreeformFeature
  return { ...madeOut(f), bodies: bodiesChanged(s, before) }
}

/** A cage put back, one undo step. */
const putBack = (id: number, data: Partial<FreeformData>): number => {
  if (!re().updateFreeform(id, data)) throw new CommandError('not_found', `There is no freeform cage ${id}.`)
  return id
}

const scanClosest = (): Closest => {
  const paths = scanPaths(session())
  return (p: Vec3) => {
    const c = paths.closest(p)
    return c ? { point: c.point, distance: c.distance } : null
  }
}

// ---- schemas --------------------------------------------------------------------------

const objIn = str('The cage as a quad OBJ: v lines and f lines (any polygon, quads as a rule); "# crease a b" lines (1-based) mark creases.')
const stepsIn = int(`How many times the cage is refined before its faces are made; 2 unless given (1–${MAX_STEPS}). More follows the limit more closely.`, { minimum: 1, maximum: MAX_STEPS })
const snapIn = bool('Take the refined surface onto the scan when it is built (QUICKSURFACE’s Snap Mode); false unless given.')
const nameIn = str('The feature’s name; “Freeform n” when left out. Unique across sketches and features.', { minLength: 1 })
const vertexIn = int('A vertex of the cage, from 0, as reverse.freeform.read lists them.', { minimum: 0 })
const moveIn = obj({ vertex: vertexIn, to: vec3('Where the vertex goes, mm.'), by: vec3('Or how far it moves, mm.') }, ['vertex'], 'One vertex moved: either to or by.')
const rectangleIn = obj(
  { origin: vec3('A corner, mm; the origin unless given.'), u: vec3('One side, mm: the rectangle runs this far along it.'), v: vec3('The other side, mm; the rectangle faces along u × v.'), nu: int('Quads along u; 2 unless given.', { minimum: 1, maximum: 100 }), nv: int('Quads along v; 2 unless given.', { minimum: 1, maximum: 100 }) },
  ['u', 'v'],
  'A rectangle of quads to start from.',
)

const OPS = ['move', 'add_face', 'add_rectangle', 'increase_resolution', 'split', 'crease', 'remove_crease', 'extrapolate', 'delete', 'smooth', 'bridge', 'close_hole', 'align', 'mirror'] as const
type OpName = (typeof OPS)[number]

interface OpIn {
  op: OpName
  [key: string]: unknown
}

const OPS_HELP =
  'Each is { op, … }: move {moves:[{vertex,to|by}], radius?, strength?} (points dragged; vertices within radius mm follow by a falloff scaled by strength 0–1); ' +
  'add_face {corners:[vertex | [x,y,z], …]} (3 or more — four clicks make a quad — wound to fit its neighbours); ' +
  'add_rectangle {origin?, u, v, nu?, nv?}; increase_resolution {} (Ctrl+R: every face cut in four, the surface unchanged); ' +
  'split {a, b, t?} (S: the loop of quads across edge a–b cut at t of the way from a, 0.5 unless given); crease {edges:[[a,b],…]}; remove_crease {edges}; ' +
  'extrapolate {a, b, by?} (a boundary edge pulled out into a new quad: by that step, or continuing its face); delete {faces?:[…], vertices?:[…]} (with the vertices only they used / the faces they belong to); ' +
  'smooth {vertices?, factor?, iterations?} (Q; boundary and crease vertices hold still); bridge {faces:[a,b]} (D: two quads joined by a tube of four); close_hole {vertex?} (a four-sided hole closed with a quad; every one unless a vertex on it is given); ' +
  'align {vertices, axis:"x"|"y"|"z", value?} (one coordinate made the same: their mean unless value); mirror {axis, offset?, tolerance?} (symmetry: the cage reflected in the plane axis = offset, vertices on it shared).'

const opsIn = arr(anyObject('{ op, … } — see the command’s description for each op’s fields.', { required: ['op'] }), `The tools applied in order, as one undo step; none is applied if one is refused (its place in the list is said). ${OPS.join(', ')}.`, { minItems: 1, maxItems: MAX_OPS })

// ---- applying an op ------------------------------------------------------------------

const list = (v: unknown, what: string): number[] => {
  if (!Array.isArray(v) || !v.every((x) => Number.isInteger(x))) return invalid(`${what} is a list of whole numbers.`)
  return v as number[]
}
const edgesOf = (v: unknown): [number, number][] => {
  if (!Array.isArray(v) || !v.every((e) => Array.isArray(e) && e.length === 2)) return invalid('edges is a list of [a, b] pairs.')
  return v as [number, number][]
}
const point = (v: unknown, what: string): Vec3 => {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) return invalid(`${what} is three numbers.`)
  return v as Vec3
}
const axisOf = (v: unknown): 'x' | 'y' | 'z' => (v === 'x' || v === 'y' || v === 'z' ? v : (invalid('axis is "x", "y" or "z".') as never))
const optNum = (v: unknown, what: string): number | undefined => {
  if (v === undefined) return undefined
  return typeof v === 'number' && Number.isFinite(v) ? v : (invalid(`${what} is a number.`) as never)
}

function moveList(o: OpIn): PointMove[] {
  if (!Array.isArray(o.moves)) return invalid('move takes moves: [{ vertex, to | by }, …].')
  return o.moves.map((m: { vertex?: unknown; to?: unknown; by?: unknown }) => ({
    vertex: m.vertex as number,
    ...(m.to !== undefined ? { to: point(m.to, 'to') } : {}),
    ...(m.by !== undefined ? { by: point(m.by, 'by') } : {}),
  }))
}

/** One op applied to a cage. */
export function applyOp(c: Cage, o: OpIn): Cage {
  switch (o.op) {
    case 'move':
      return movePoints(c, moveList(o), optNum(o.radius, 'radius'), optNum(o.strength, 'strength'))
    case 'add_face':
      if (!Array.isArray(o.corners)) return invalid('add_face takes corners: vertices and points, three or more.')
      return addFace(c, o.corners.map((k: unknown) => (typeof k === 'number' ? k : point(k, 'A corner'))))
    case 'add_rectangle':
      return addRectangle(c, o.origin === undefined ? [0, 0, 0] : point(o.origin, 'origin'), point(o.u, 'u'), point(o.v, 'v'), (o.nu as number | undefined) ?? 2, (o.nv as number | undefined) ?? 2)
    case 'increase_resolution':
      return increaseResolution(c)
    case 'split':
      return splitLoop(c, o.a as number, o.b as number, optNum(o.t, 't'))
    case 'crease':
      return setCrease(c, edgesOf(o.edges), true)
    case 'remove_crease':
      return setCrease(c, edgesOf(o.edges), false)
    case 'extrapolate':
      return extrapolate(c, o.a as number, o.b as number, o.by === undefined ? undefined : point(o.by, 'by'))
    case 'delete':
      if (o.faces !== undefined && o.vertices !== undefined) return invalid('delete takes faces or vertices, not both.')
      if (o.faces !== undefined) return deleteFaces(c, list(o.faces, 'faces'))
      if (o.vertices !== undefined) return deleteVertices(c, list(o.vertices, 'vertices'))
      return invalid('delete takes faces or vertices.')
    case 'smooth':
      return smooth(c, o.vertices === undefined ? undefined : list(o.vertices, 'vertices'), optNum(o.factor, 'factor'), optNum(o.iterations, 'iterations'))
    case 'bridge': {
      const f = list(o.faces, 'faces')
      if (f.length !== 2) return invalid('bridge takes faces: [a, b].')
      return bridge(c, f[0], f[1])
    }
    case 'close_hole':
      return closeHole(c, o.vertex as number | undefined)
    case 'align':
      return align(c, list(o.vertices, 'vertices'), axisOf(o.axis), optNum(o.value, 'value'))
    case 'mirror':
      return mirror(c, axisOf(o.axis), optNum(o.offset, 'offset'), optNum(o.tolerance, 'tolerance'))
    default:
      return invalid(`There is no op “${String((o as { op?: unknown }).op)}”; the ops are ${OPS.join(', ')}.`)
  }
}

/** The ops applied in order; a refusal names the op. */
export function applyOps(c: Cage, ops: readonly OpIn[]): Cage {
  let cage = c
  ops.forEach((o, i) => {
    cage = guarded(`Edit ${i + 1} (${String(o?.op)})`, () => applyOp(cage, o))
  })
  return cage
}

const MAX_FACES = 200_000
function checkSize(c: Cage): void {
  if (c.faces.length > MAX_FACES) invalid(`The cage has ${c.faces.length} faces; at most ${MAX_FACES}.`)
}

// ---- the commands ---------------------------------------------------------------------

export const freeformCreate: Command<{ name?: string; obj?: string; rectangle?: { origin?: Vec3; u: Vec3; v: Vec3; nu?: number; nv?: number }; steps?: number; snap?: boolean }> = {
  name: 'create',
  title: 'Make a freeform cage',
  description:
    'Add a freeform cage to the part: the control polygon of a subdivision surface, from a quad OBJ (as QUICKSURFACE exports its Freeform surfaces, or reverse.freeform.read writes one) or a rectangle of quads to start from. The build makes it a body of B-spline faces — a solid where the cage is closed, else a sheet — refined `steps` times (2 unless given) and, with snap true, taken onto the scan as QUICKSURFACE’s Snap Mode does. One undo step. Edit it with reverse.freeform.edit, move_points, refine and snap; set what is made of it with reverse.freeform.convert. Returns the feature and its result, the body (faces, solid, valid, area, volume), the cage measured and the bodies changed.',
  input: obj({ name: nameIn, obj: objIn, rectangle: rectangleIn, steps: stepsIn, snap: snapIn }, []),
  label: ({ name }) => `add freeform cage${typeof name === 'string' ? ` “${name}”` : ''}`,
  run: async ({ name, obj: objText, rectangle, steps = 2, snap = false }) => {
    if ((objText === undefined) === (rectangle === undefined)) return invalid('Give either obj (the cage as a quad OBJ) or rectangle (u, v, and how many quads).')
    requireFreeName(name)
    const cage = guarded('The cage', () => {
      const c = objText !== undefined ? parseQuadObj(objText) : addRectangle({ positions: new Float64Array(0), faces: [], creases: [] }, rectangle!.origin ?? [0, 0, 0], rectangle!.u, rectangle!.v, rectangle!.nu ?? 2, rectangle!.nv ?? 2)
      topology(c)
      return c
    })
    checkSize(cage)
    if (cage.faces.length === 0) return invalid('The cage has no faces.')
    const out = await commit(() => re().addFreeform({ ...dataOf(cage), steps, snap }, name), snap)
    return { ...out, cage: cageOut(cage) }
  },
}

export const freeformRead: Command<{ feature: Ref; vertices?: boolean; obj?: boolean; deviation?: boolean; tolerance?: number }> = {
  name: 'read',
  title: 'Read a freeform cage',
  description:
    `A freeform cage read: its counts, open edges and holes (the sizes of its boundary loops), creases, valences, bounds and area, and what the build made of it. With vertices true its points and faces (up to ${LIST_CAP} of each) — the indices every edit picks by; with obj true the cage as a quad OBJ; with deviation true, and the scan open, the distance of the cage’s refined surface from the scan (rms, max, how many points lie within tolerance, ${TOLERANCE_MM} mm unless given; the legend runs ±${LEGEND_MM} mm).`,
  input: obj({ feature: featureRef('freeform cage'), vertices: bool('List the points and faces.'), obj: bool('Also the cage as a quad OBJ.'), deviation: bool('Measure the surface against the open scan.'), tolerance: num('mm; the deviation display’s tolerance.', { exclusiveMinimum: 0 }) }, ['feature']),
  readOnly: true,
  run: async ({ feature, vertices = false, obj: wantObj = false, deviation: dev = false, tolerance = TOLERANCE_MM }) => {
    const f = freeformNamed(feature)
    const c = cageOf(f)
    const out: Json = { ...madeOut(f), cage: cageOut(c), steps: f.steps, snap: f.snap, ...(f.ask ? { ask: f.ask } : {}) }
    if (vertices) {
      out.points = Array.from({ length: Math.min(vertexCount(c), LIST_CAP) }, (_, i) => [round3(c.positions[i * 3]), round3(c.positions[i * 3 + 1]), round3(c.positions[i * 3 + 2])])
      out.faceList = c.faces.slice(0, LIST_CAP)
      out.creaseList = c.creases
      if (vertexCount(c) > LIST_CAP || c.faces.length > LIST_CAP) out.truncated = true
    }
    if (wantObj) out.obj = writeQuadObj(c)
    if (dev) {
      const d = deviation(c, scanClosest(), tolerance)
      out.deviation = { points: d.points, missed: d.missed, rms: round3(d.rms), max: round3(d.max), within: d.within, tolerance, legend: LEGEND_MM, fraction: d.points > 0 ? round3(d.within / d.points) : 0 }
    }
    return out
  },
}

export const freeformEdit: Command<{ feature: Ref; ops: OpIn[] }> = {
  name: 'edit',
  title: 'Edit a freeform cage',
  description: `The freeform editor’s tools on a cage, applied in order as one undo step. ${OPS_HELP} Picks are indices (reverse.freeform.read vertices true). Nothing is applied if one is refused, the refusal saying which. Returns the feature and its result, the body built, the cage measured and the bodies changed.`,
  input: obj({ feature: featureRef('freeform cage'), ops: opsIn }, ['feature', 'ops']),
  label: () => 'edit freeform cage',
  run: ({ feature, ops }) => editRun(feature, ops),
}

async function editRun(feature: Ref, ops: OpIn[]): Promise<Json> {
  {
    const f = freeformNamed(feature)
    const cage = applyOps(cageOf(f), ops)
    checkSize(cage)
    return { ...(await commit(() => putBack(f.id, dataOf(cage)))), cage: cageOut(cage) }
  }
}

export const freeformMovePoints: Command<{ feature: Ref; moves: PointMove[]; radius?: number; strength?: number }> = {
  name: 'move_points',
  title: 'Move freeform points',
  description: 'Points of a freeform cage moved — each to a place or by a step — and the vertices within `radius` mm of a moved one following it by a smooth falloff scaled by `strength` (0–1, 1 unless given): the editor’s Manipulate drag. One undo step. Same answer as reverse.freeform.edit.',
  input: obj({ feature: featureRef('freeform cage'), moves: arr(moveIn, 'The vertices moved.', { minItems: 1 }), radius: num('mm; neighbours within it follow. 0 (only the picked) unless given.', { minimum: 0 }), strength: num('0–1; how fully the neighbours follow.', { minimum: 0, maximum: 1 }) }, ['feature', 'moves']),
  label: () => 'move freeform points',
  run: ({ feature, moves, radius, strength }) => editRun(feature, [{ op: 'move', moves, ...(radius !== undefined ? { radius } : {}), ...(strength !== undefined ? { strength } : {}) }]),
}

export const freeformRefine: Command<{ feature: Ref; times?: number }> = {
  name: 'refine',
  title: 'Increase the resolution of a freeform cage',
  description: 'Increase Resolution (Ctrl+R) on a freeform cage: every face cut into four, `times` times (1 unless given, up to 3) — the surface does not change, the cage has four times the points to shape it with. One undo step. Same answer as reverse.freeform.edit.',
  input: obj({ feature: featureRef('freeform cage'), times: int('How many times; 1 unless given.', { minimum: 1, maximum: 3 }) }, ['feature']),
  label: () => 'increase freeform resolution',
  run: ({ feature, times = 1 }) => editRun(feature, Array.from({ length: times }, () => ({ op: 'increase_resolution' as const }))),
}

export const freeformSnap: Command<{ feature: Ref; iterations?: number; tolerance?: number }> = {
  name: 'snap',
  title: 'Snap a freeform cage to the scan',
  description: `The cage’s vertices moved so the surface they make lies on the open scan: each by the gap between its point on the surface and the scan’s nearest point, up to \`iterations\` times (8 unless given) or until the gap is under 0.01 mm. A vertex the scan is out of reach of holds still. Measured as the deviation display is: the distance of the refined surface from the scan before and after (rms, max, points within tolerance — ${TOLERANCE_MM} mm unless given; legend ±${LEGEND_MM} mm). One undo step. Needs the ScanRuler page with the scan shown.`,
  input: obj({ feature: featureRef('freeform cage'), iterations: int('1–100; 8 unless given.', { minimum: 1, maximum: 100 }), tolerance: num('mm; the deviation display’s tolerance.', { exclusiveMinimum: 0 }) }, ['feature']),
  label: () => 'snap freeform cage to the scan',
  run: async ({ feature, iterations = 8, tolerance = TOLERANCE_MM }) => {
    const f = freeformNamed(feature)
    const closest = scanClosest()
    const cage = cageOf(f)
    const was = deviation(cage, closest, tolerance)
    if (was.points === 0) return invalid('The scan is out of reach of the cage’s surface; nothing to snap to.')
    const r = guarded('Snap', () => snapCage(cage, closest, iterations, 0.01))
    const now = deviation(r.cage, closest, tolerance)
    const show = (d: typeof was) => ({ points: d.points, missed: d.missed, rms: round3(d.rms), max: round3(d.max), within: d.within, fraction: d.points > 0 ? round3(d.within / d.points) : 0 })
    const out = await commit(() => putBack(f.id, dataOf(r.cage)))
    return { ...out, snapped: { iterations: r.stats.iterations, tolerance, legend: LEGEND_MM, before: show(was), after: show(now) } }
  },
}

const thickenIn = obj({ thickness: num('mm; positive.', { exclusiveMinimum: 0 }), side: enumOf(['out', 'in', 'both'], 'out unless given.'), direction: enumOf(['auto', 'x', 'y', 'z'], 'auto unless given.') }, ['thickness'], 'Thicken as reverse.freeform.cage_thicken does.')
const offsetIn = obj({ distance: num('mm, along the normal; negative against it; not zero.') }, ['distance'], 'Offset as reverse.freeform.cage_offset does.')

export const freeformConvert: Command<{ feature: Ref; steps?: number; snap?: boolean; thicken?: { thickness: number; side?: 'in' | 'out' | 'both'; direction?: 'auto' | 'x' | 'y' | 'z' }; offset?: { distance: number }; plain?: boolean }> = {
  name: 'convert',
  title: 'Set what a freeform cage is made into',
  description:
    'What the build makes of a freeform cage, set and built: how many times it is refined (steps), whether the surface is taken onto the scan (snap), and whether the body is thickened (thicken {thickness, side, direction}) or offset (offset {distance}) as reverse.freeform.cage_thicken / cage_offset do, the original kept for an offset. Give plain true to make the plain body again. One undo step. The body is the feature’s own, like a sheet: export it with reverse.export.step. Same answer as reverse.freeform.edit, with shell (the thicken or offset’s result) in it.',
  input: obj({ feature: featureRef('freeform cage'), steps: stepsIn, snap: snapIn, thicken: thickenIn, offset: offsetIn, plain: bool('Make the plain body: no thickening, no offset.') }, ['feature']),
  label: () => 'set freeform conversion',
  run: async ({ feature, steps, snap, thicken, offset, plain }) => {
    const f = freeformNamed(feature)
    if ((thicken ? 1 : 0) + (offset ? 1 : 0) + (plain ? 1 : 0) > 1) return invalid('Give one of thicken, offset or plain.')
    const ask: FreeformAsk | undefined | null = thicken ? { kind: 'thicken', thickness: thicken.thickness, side: thicken.side ?? 'out', direction: thicken.direction ?? 'auto' } : offset ? { kind: 'offset', distance: offset.distance } : plain ? null : undefined
    if (ask?.kind === 'offset' && !(Math.abs(ask.distance) > 1e-9)) return invalid('The offset needs a distance.')
    if (ask?.kind === 'thicken' && !(ask.thickness > 0)) return invalid('The thickness must be positive.')
    const next: Partial<FreeformData> = { ...(steps !== undefined ? { steps } : {}), ...(snap !== undefined ? { snap } : {}), ...(ask === null ? { ask: undefined } : ask ? { ask } : {}) }
    return commit(() => putBack(f.id, next), (snap ?? f.snap) === true)
  },
}
