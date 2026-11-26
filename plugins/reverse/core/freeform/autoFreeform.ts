// SPDX-License-Identifier: AGPL-3.0-only
// Auto Freeform: a scan in, a quad cage on it out.
//
// QUICKSURFACE 8.0.128 makes its Auto Freeform cages with two outside quad
// remeshers it ships beside itself (analysis/quick-scan-v1.2.31/PLAN.md):
// Instant Meshes, whose results its Basic algorithm matches count for count
// (measured: bakeoff/RESULTS.md), and a proprietary one for Feature aligned.
// Here both algorithms run on one field-aligned layout (instant/, a port of
// Instant Meshes); Feature aligned adds to it what makes the quads follow
// the part — creases kept sharp, the directions of strong curvature given to
// the field, more quads where Feature Details asks — and the options of
// QUICKSURFACE's dialog: symmetry, guide curves, the selected triangles
// only, improved rims.
//
// The stages, each reported as it runs:
//   prepare   the working copy of the scan (autoPrepare.ts)
//   layout    the quads (instant/)
//   fit       the cage's vertices solved so its surface lies on the scan (limitFit.ts)
//   refine    where the surface is still off by more than a tolerance asked for, more quads
//   measure   the surface's distance to the scan, and the mesh shown as the preview
//
// Pure and synchronous: it runs in autoWorker.ts, where stopping it is
// ending the worker, and directly under the tests.

import { ScanPaths } from '../../../../src/core/geometry/scanPath'
import type { Vec3 } from '../../../../src/core/types'
import type { AutoTools } from './autoTools'
import { type DirectionConstraint, type WorkMesh, fillCageHoles, guideConstraints, improveRims, mainPieces, meshArea, mirrored, positiveHalf, subMesh, welded, withoutSlivers } from './autoPrepare'
import { featureConstraints, featureDetailWeight } from './autoFeatures'
import { offShare, refineToTolerance } from './autoRefine'
import type { Cage } from './cage'
import { coverageProbes, scanCoverage, type ScanCoverage } from './scanCoverage'
import { instantQuads } from './instant'
import { type FitStats, type ScanProject, fitCageToScan, surfaceDeviation } from './limitFit'

/** The target quads of Low, Medium and Fine: QUICKSURFACE's own. */
export const AUTO_TARGETS = { low: 1000, medium: 2000, fine: 4000 } as const
export type AutoDensity = keyof typeof AUTO_TARGETS

/**
 * How many times an Auto Freeform cage is refined for its CAD faces. Measured on basic_part, Basic Medium (1980 quads,
 * closed; bakeoff/RESULTS.md): at 2 the faces of neighbouring blocks stand too far apart at the irregular points to sew
 * and the body falls back to a face a quad (1980 faces, 20 s); at 3 it sews into 191 faces (17 s), at 4 into 166 (25 s).
 */
export const AUTO_BUILD_STEPS = 3

/** The fewest and the most quads a cage is asked for. */
export const AUTO_QUADS_MIN = 100
export const AUTO_QUADS_MAX = 100_000

export type AutoAlgorithm = 'basic' | 'feature'
export const AUTO_ALGORITHMS: readonly AutoAlgorithm[] = ['basic', 'feature']

/**
 * Feature Details, as QUICKSURFACE's: how many more quads than the target the features are given. Its counts
 * on basic_part at Medium (target 2000), measured on 8.0.128: Low 2079, Balanced 4375, Higher 7759, Highest
 * 11589 — the factors here.
 */
export type AutoDetails = 'low' | 'balanced' | 'higher' | 'highest'
export const AUTO_DETAILS: readonly AutoDetails[] = ['low', 'balanced', 'higher', 'highest']
export const DETAIL_FACTOR: Record<AutoDetails, number> = { low: 1.04, balanced: 2.19, higher: 3.88, highest: 5.79 }

/** Symmetry: none, or the global plane the cage is made mirror-symmetric about — OXY (z = 0), OYZ (x = 0) or OXZ (y = 0). */
export type AutoSymmetry = 'none' | 'oxy' | 'oyz' | 'oxz'
export const AUTO_SYMMETRIES: readonly AutoSymmetry[] = ['none', 'oxy', 'oyz', 'oxz']
const PLANE_AXIS: Record<Exclude<AutoSymmetry, 'none'>, number> = { oyz: 0, oxz: 1, oxy: 2 }

/** The working copy a layout is made of: this many triangles a quad asked for, within these bounds. */
const LAYOUT_TRIANGLES_PER_QUAD = 40
const LAYOUT_TRIANGLES_MIN = 40_000
const LAYOUT_TRIANGLES_MAX = 400_000

/** With Refine to tolerance: this share of the quads still off after the rows added, the cage is laid out again at twice the quads. */
const RELAY_OFF_SHARE = 0.25

/** A hole of the layout with no more edges than this, over scan, is closed with quads. */
const CAGE_HOLE_EDGES = 12

/** The dihedral angle past which an edge of the scan is kept sharp in the layout, unless another is given. */
export const AUTO_HARD_EDGE_DEG = 40

export interface AutoSettings {
  algorithm: AutoAlgorithm
  /** Target quads. */
  quads: number
  /** Feature aligned only. */
  details?: AutoDetails
  symmetry?: AutoSymmetry
  /** Improve holes' boundaries. */
  improveHoles?: boolean
  /** Guide curves drawn on the mesh: polylines, xyz flat, mm. */
  guides?: number[][]
  /** Extract from selected triangles only: the triangles, by index. */
  selection?: Uint32Array
  /** Refine to tolerance, mm: quads are added where the surface is further than this from the scan. Off when absent or 0. */
  refineTolerance?: number
  /** Hard edge angle, degrees (Feature aligned). */
  hardEdgeAngle?: number
  /** The tolerance the result is counted against, mm; 0.05 unless given. */
  tolerance?: number
  /** For measurements only: Feature aligned's parts switched and tuned. */
  tune?: { anisotropy?: number; bend?: number; hard?: boolean; curvature?: boolean; crease?: boolean; creaseAngle?: number }
}

export type AutoStage = 'prepare' | 'layout' | 'fit' | 'refine' | 'measure'
export const AUTO_STAGE_LABEL: Record<AutoStage, string> = {
  prepare: 'Preparing the scan',
  layout: 'Laying out the quads',
  fit: 'Fitting to the scan',
  refine: 'Refining to tolerance',
  measure: 'Measuring the surface',
}
/** The share of the whole each stage is given on the progress bar. */
const STAGE_SPAN: Record<AutoStage, [number, number]> = { prepare: [0, 0.06], layout: [0.06, 0.7], fit: [0.7, 0.86], refine: [0.86, 0.94], measure: [0.94, 1] }

export type AutoProgress = (stage: AutoStage, overall: number) => void

export class AutoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AutoError'
  }
}

export interface AutoOutcome {
  cage: Cage
  algorithm: AutoAlgorithm
  target: number
  quads: number
  vertices: number
  /** Inner vertices with other than four edges. */
  irregular: number
  /** Mean edge of the cage, mm. */
  edge: number
  closed: boolean
  boundaryEdges: number
  /** Edges of the cage kept sharp. */
  creases: number
  /** Connected pieces of the scan, and how many the cage was made of. */
  pieces: number
  piecesKept: number
  symmetry: AutoSymmetry
  /** With a symmetry: each vertex's mirror partner (itself on the plane) and the count on the plane. */
  mirror?: { axis: number; partner: Int32Array; onPlane: number }
  fit: FitStats
  /** The fitted surface against the scan. */
  deviation: { tolerance: number; points: number; missed: number; rms: number; max: number; within: number }
  /** Area-sampled distance in the opposite direction, from the selected scan to the preview. */
  coverage: ScanCoverage
  /** Quads added by Refine to tolerance. */
  refined: number
  topologyResolutionRaised: boolean
  /** The limit surface as a mesh, for the preview. */
  surface: { positions: Float32Array; normals: Float32Array; indices: Uint32Array; edgeSegments: Uint32Array; signed: Float32Array }
  /** Time of each stage, ms. */
  ms: Record<AutoStage, number>
}

function bounds(p: ArrayLike<number>): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i + 2 < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (p[i + k] < min[k]) min[k] = p[i + k]
      if (p[i + k] > max[k]) max[k] = p[i + k]
    }
  }
  return { min, max }
}

/** The positions made mirror-symmetric: each vertex and its partner's mirror image meet at their middle, a vertex on the plane is put on it. */
export function mirrorPositions(positions: Float64Array, mirror: { axis: number; partner: Int32Array }): Float64Array {
  const out = Float64Array.from(positions)
  const a = mirror.axis
  for (let v = 0; v < mirror.partner.length; v++) {
    const w = mirror.partner[v]
    if (w < 0 || w < v) continue
    if (w === v) {
      out[v * 3 + a] = 0
      continue
    }
    for (let k = 0; k < 3; k++) {
      const pv = positions[v * 3 + k]
      const pw = positions[w * 3 + k] * (k === a ? -1 : 1)
      const mid = (pv + pw) / 2
      out[v * 3 + k] = mid
      out[w * 3 + k] = k === a ? -mid : mid
    }
  }
  return out
}

/** What a cage's connectivity comes to. */
export function cageCounts(c: Cage): { irregular: number; edge: number; closed: boolean; boundaryEdges: number } {
  const n = c.positions.length / 3
  const count = new Map<number, number>()
  const key = (a: number, b: number) => (a < b ? a * n + b : b * n + a)
  for (const f of c.faces) for (let k = 0; k < f.length; k++) count.set(key(f[k], f[(k + 1) % f.length]), (count.get(key(f[k], f[(k + 1) % f.length])) ?? 0) + 1)
  const valence = new Int32Array(n)
  const rim = new Uint8Array(n)
  let boundaryEdges = 0, sum = 0
  const p = c.positions
  for (const [e, k] of count) {
    const a = Math.floor(e / n), b = e % n
    valence[a]++
    valence[b]++
    if (k === 1) {
      boundaryEdges++
      rim[a] = 1
      rim[b] = 1
    }
    sum += Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2])
  }
  let irregular = 0
  for (let v = 0; v < n; v++) if (valence[v] > 0 && !rim[v] && valence[v] !== 4) irregular++
  return { irregular, edge: count.size > 0 ? sum / count.size : 0, closed: boundaryEdges === 0, boundaryEdges }
}

/** The scan as something a surface point can be taken to: the nearest point whose side agrees with the surface's. */
export function scanProjector(paths: ScanPaths): ScanProject {
  return (p, normal) => {
    const c = paths.closest(p)
    if (!c) return null
    // A wall's other face: nearer, perhaps, but not the surface this sample is on.
    if (c.normal[0] * normal[0] + c.normal[1] * normal[1] + c.normal[2] * normal[2] < -0.2) return null
    return { point: c.point, normal: c.normal, distance: c.distance }
  }
}

/** The whole of Auto Freeform: see the head of the file. `progress` may throw to stop it. */
export function runAutoFreeform(scan: { positions: Float32Array | Float64Array; indices: Uint32Array }, settings: AutoSettings, progress: AutoProgress = () => {}, tools?: AutoTools): AutoOutcome {
  const algorithm = settings.algorithm
  const target = settings.quads
  if (!AUTO_ALGORITHMS.includes(algorithm)) throw new AutoError('Algorithm: basic or feature.')
  if (!Number.isFinite(target) || target < AUTO_QUADS_MIN || target > AUTO_QUADS_MAX) throw new AutoError(`Target quads: from ${AUTO_QUADS_MIN} to ${AUTO_QUADS_MAX}.`)
  if (scan.indices.length < 3) throw new AutoError('There is no scan to make a freeform from.')
  const symmetry = settings.symmetry ?? 'none'
  if (!AUTO_SYMMETRIES.includes(symmetry)) throw new AutoError('Symmetry: none, oxy, oyz or oxz.')
  const axis = symmetry === 'none' ? -1 : PLANE_AXIS[symmetry]
  const tolerance = settings.tolerance ?? 0.05
  const ms: Record<AutoStage, number> = { prepare: 0, layout: 0, fit: 0, refine: 0, measure: 0 }
  let stage: AutoStage = 'prepare'
  let started = performance.now()
  let furthest = 0
  /** What the listener threw, when it did: a stop, to be passed on as it is. */
  let stopped: unknown
  const report = (fraction: number) => {
    const [a, b] = STAGE_SPAN[stage]
    // Never backwards: a stage that tries again (the layout, for its count) holds the bar where it was.
    furthest = Math.max(furthest, a + (b - a) * Math.min(1, Math.max(0, fraction)))
    try {
      progress(stage, furthest)
    } catch (e) {
      stopped = e ?? new Error('stopped')
      throw e
    }
  }
  const enter = (next: AutoStage) => {
    const now = performance.now()
    ms[stage] += now - started
    started = now
    stage = next
    report(0)
  }
  report(0)

  // ---- prepare
  let work: WorkMesh = { positions: scan.positions instanceof Float32Array ? scan.positions : Float32Array.from(scan.positions), indices: scan.indices }
  if (settings.selection) {
    if (settings.selection.length === 0) throw new AutoError('No triangles are selected to extract from.')
    work = subMesh(work, settings.selection)
  }
  // The selection names triangles of the scan as it came, so the weld — which keeps their order — comes after it.
  work = withoutSlivers(welded(work))
  if (work.indices.length < 3) throw new AutoError('The scan has no surface to make a freeform from.')
  const whole = mainPieces(work)
  work = whole.mesh
  const area = meshArea(work)
  if (!(area > 0)) throw new AutoError('The scan has no surface to make a freeform from.')
  // The scan the cage is fitted to and measured against: the part asked for, without the crumbs.
  const reference = work
  const { min, max } = bounds(work.positions)
  if (axis >= 0) {
    if (!(min[axis] < 0 && max[axis] > 0)) throw new AutoError(`The scan does not cross the ${symmetry.toUpperCase()} plane (${'xyz'[axis]} = 0), so it cannot be made symmetric about it.`)
    work = positiveHalf(work, axis)
    if (work.indices.length < 3) throw new AutoError(`Nothing of the scan lies on the positive side of the ${symmetry.toUpperCase()} plane.`)
  }
  const detail = settings.details ?? 'balanced'
  // Additional rows along a ridge scale with its length divided by the nominal
  // quad width. The ordinary surface cells scale with area instead.
  const weight = algorithm === 'feature' && detail !== 'low'
    ? featureDetailWeight(reference, area) * Math.sqrt(AUTO_TARGETS.medium / target)
    : 1
  const factor = algorithm === 'feature' ? 1 + (DETAIL_FACTOR[detail] - 1) * weight : 1
  const asked = Math.max(16, Math.round((target * factor) / (axis >= 0 ? 2 : 1)))
  const layoutArea = axis >= 0 ? meshArea(work) : area
  const scale = Math.sqrt(layoutArea / asked)
  report(0.3)
  if (settings.improveHoles) work = improveRims(work, 4 * scale).mesh
  // A dense scan is laid out on a lighter copy: enough triangles under every quad for the field to read the shape, no more.
  const budget = Math.min(LAYOUT_TRIANGLES_MAX, Math.max(LAYOUT_TRIANGLES_MIN, LAYOUT_TRIANGLES_PER_QUAD * asked))
  if (tools && work.indices.length / 3 > 1.25 * budget) work = tools.simplify(work, budget)
  report(0.7)
  const constraints: DirectionConstraint[] = []
  // Measured on basic_part at 4380 quads (bakeoff/RESULTS.md): the hard edges and curvature directions given to the
  // layout as constraints raise the irregular points from 2.0 % to 2.4–3.3 %, so they are given only when asked.
  if (algorithm === 'feature' && settings.tune && (settings.tune.hard === true || settings.tune.curvature === true)) {
    constraints.push(...featureConstraints(work, scale, settings.hardEdgeAngle ?? AUTO_HARD_EDGE_DEG, { ...settings.tune, hard: settings.tune.hard === true, curvature: settings.tune.curvature === true }))
  }
  if (settings.guides && settings.guides.length > 0) constraints.push(...guideConstraints(work, settings.guides, scale / 4))

  // ---- layout
  enter('layout')
  const LAYOUT_SHARE: Record<string, [number, number]> = { prepare: [0, 0.08], hierarchy: [0.08, 0.2], orientation: [0.2, 0.5], position: [0.5, 0.8], extract: [0.8, 0.95], smooth: [0.95, 1] }
  // The scan the cage is fitted to: made here, so that a small hole the layout left can be told from a hole of the scan's.
  const paths = new ScanPaths(reference.positions, reference.indices)
  const project = scanProjector(paths)
  /** The cage of `count` quads (of the half, with a symmetry), whole. */
  const layOut = (count: number): { cage: Cage; mirror: AutoOutcome['mirror']; scale: number; topologyResolutionRaised: boolean } => {
    let laid
    try {
      laid = instantQuads(work, {
        quads: count,
        boundaries: true,
        // The scan's sharp edges kept sharp in the field, for both algorithms: measured (bakeoff/RESULTS.md), it brings the
        // fitted surface nearer the scan — basic_part 0.209 → 0.161 mm rms, lego 0.037 → 0.031 — at the same share of irregular points.
        creaseAngle: typeof settings.tune?.creaseAngle === 'number' ? (settings.tune.creaseAngle >= 0 ? settings.tune.creaseAngle : undefined) : settings.tune?.crease === false ? undefined : (settings.hardEdgeAngle ?? AUTO_HARD_EDGE_DEG),
        constraints,
        progress: (s, f) => {
          const [a, b] = LAYOUT_SHARE[s] ?? [0, 1]
          report(a + (b - a) * f)
        },
      })
    } catch (e) {
      if (stopped !== undefined) throw stopped
      if (e instanceof AutoError) throw e
      throw new AutoError(`Failed to reconstruct. The data are not suitable for Auto Freeform (${e instanceof Error ? e.message : String(e)}).`)
    }
    if (laid.faces.length === 0) throw new AutoError('Failed to reconstruct. The data are not suitable for Auto Freeform.')
    const reach = laid.scale
    let positions = laid.positions
    let faces = laid.faces
    const covered = (c: [number, number, number]): boolean => {
      const q = paths.closest(c)
      if (!q || q.distance > 1.5 * reach) return false
      // A point beyond a scan rim can be near the rim without lying over scan.
      const normalGap = Math.abs((c[0]-q.point[0])*q.normal[0] + (c[1]-q.point[1])*q.normal[1] + (c[2]-q.point[2])*q.normal[2])
      return q.distance <= 1e-6 * reach || normalGap >= 0.7 * q.distance
    }
    {
      const filled = fillCageHoles(positions, faces, CAGE_HOLE_EDGES, covered)
      positions = filled.positions
      faces = filled.faces
    }
    let made: AutoOutcome['mirror']
    if (axis >= 0) {
      const whole2 = mirrored(positions, faces, axis, 0.45 * reach)
      positions = whole2.positions
      faces = whole2.faces
      let partner = whole2.partner
      // A hole left across the plane is closed from a vertex on it, alike on both sides; its middle is on the plane.
      const filled = fillCageHoles(positions, faces, CAGE_HOLE_EDGES, covered, (v) => partner[v] === v)
      if (filled.centres.length > 0) {
        const grown = new Int32Array(filled.positions.length / 3)
        grown.set(partner)
        for (const c of filled.centres) {
          grown[c] = c
          filled.positions[c * 3 + axis] = 0
        }
        partner = grown
        positions = filled.positions
        faces = filled.faces
      }
      let onPlane = 0
      for (let v = 0; v < partner.length; v++) if (partner[v] === v) onPlane++
      made = { axis, partner, onPlane }
    }
    return { cage: { positions, faces, creases: [] }, mirror: made, scale: reach, topologyResolutionRaised: laid.topologyResolutionRaised === true }
  }
  let laid = layOut(asked)
  let cage: Cage = laid.cage
  let mirror = laid.mirror

  // ---- fit
  enter('fit')
  const symmetric = (c: Cage, m: AutoOutcome['mirror']): Cage => (m ? { ...c, positions: mirrorPositions(c.positions, m) } : c)
  const fitOptions = algorithm === 'feature' && detail !== 'low' ? { iterations: 8, fairness: 0.012 } : { iterations: 5 }
  let fitted = fitCageToScan(cage, project, { ...fitOptions, progress: report })
  cage = symmetric(fitted.cage, mirror)

  // ---- refine
  enter('refine')
  let refined = 0
  const probes = coverageProbes(reference)
  const measureFit = (candidate: Cage, scale: number) => {
    const mesh = surfaceDeviation(candidate, project, tolerance, 2, 6 * scale, true)
    return { mesh, coverage: scanCoverage(probes, mesh, tolerance) }
  }
  let measured: ReturnType<typeof measureFit> | undefined
  if (settings.refineTolerance && settings.refineTolerance > 0) {
    const before = cage.faces.length
    const cap = Math.min(AUTO_QUADS_MAX, 2 * before)
    const log = (settings.tune as { log?: (line: string) => void } | undefined)?.log
    let off = offShare(cage, project, settings.refineTolerance)
    // Rows of quads where the surface is off — where the quads' rings allow it, and the cage has no mirror half to keep in step.
    if (!mirror && off > 0) {
      const r = refineToTolerance(cage, project, settings.refineTolerance, { maxQuads: cap, progress: (f) => report(0.6 * f), log })
      cage = r.cage
      fitted = { cage, stats: r.stats ?? fitted.stats }
      off = cage.faces.length > 0 ? r.off / cage.faces.length : 0
    }
    // Still off over much of it, and few quads added: the whole is laid out again, finer.
    measured = measureFit(cage, laid.scale)
    const currentCoverage = measured.coverage
    // A layout may have low forward RMS simply because it omitted part of the scan.
    const missingRegion = currentCoverage.max > laid.scale && currentCoverage.rms > settings.refineTolerance
    if ((off > RELAY_OFF_SHARE && cage.faces.length < 1.25 * before) || missingRegion) {
      report(0.6)
      const finer = layOut(Math.min(Math.round(2 * asked), Math.round(AUTO_QUADS_MAX / (axis >= 0 ? 2 : 1))))
      const again = fitCageToScan(finer.cage, project, { ...fitOptions, progress: (f) => report(0.8 + 0.2 * f) })
      const candidate = symmetric(again.cage, finer.mirror)
      log?.(`laid out again: ${candidate.faces.length} quads, fit rms ${again.stats.rms.toFixed(5)} against ${fitted.stats.rms.toFixed(5)}`)
      const next = measureFit(candidate, finer.scale)
      const betterFit = next.mesh.points > 0 && Math.hypot(next.mesh.rms, next.coverage.rms) < Math.hypot(measured.mesh.rms, currentCoverage.rms)
      if (betterFit && (!missingRegion || next.coverage.max <= currentCoverage.max)) {
        measured = next
        cage = candidate
        mirror = finer.mirror
        fitted = { cage, stats: again.stats }
        laid = finer
      }
    }
    refined = cage.faces.length - before
  }

  // ---- measure
  enter('measure')
  const { mesh: d, coverage } = measured ?? measureFit(cage, laid.scale)
  const counts = cageCounts(cage)
  ms.measure += performance.now() - started
  report(1)
  return {
    cage,
    algorithm,
    target,
    quads: cage.faces.length,
    vertices: cage.positions.length / 3,
    irregular: counts.irregular,
    edge: counts.edge,
    closed: counts.closed,
    boundaryEdges: counts.boundaryEdges,
    creases: cage.creases.length,
    pieces: whole.pieces,
    piecesKept: whole.kept,
    symmetry,
    mirror,
    fit: fitted.stats,
    coverage,
    deviation: { tolerance, points: d.points, missed: d.missed, rms: d.rms, max: d.max, within: d.within },
    refined,
    topologyResolutionRaised: laid.topologyResolutionRaised,
    surface: { positions: d.positions, normals: d.normals, indices: d.indices, signed: d.signed, edgeSegments: d.edgeSegments },
    ms,
  }
}
