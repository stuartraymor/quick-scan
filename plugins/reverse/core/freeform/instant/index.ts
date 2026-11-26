// SPDX-License-Identifier: AGPL-3.0-only
// A TypeScript port of the parts of Instant Meshes ("Instant Field-Aligned
// Meshes", ACM Transactions on Graphics 34(6), 2015) that turn a triangle
// mesh into a pure quad mesh: batch.cpp run with rosy 4, posy 4, extrinsic,
// pure quads, deterministic.
// Copyright (c) 2015 Wenzel Jakob, Daniele Panozzo, Marco Tarini, and Olga Sorkine-Hornung
// (BSD-3-Clause; the licence text is in ATTRIBUTION.md).
//
// The pipeline, as in batch.cpp: statistics → subdivision of edges too long
// for the field → directed edges, adjacency, normals, vertex areas → the
// multi-resolution hierarchy → boundary (and caller) constraints → the
// orientation field → the position field → extraction of the quads.
//
// Synchronous, single-threaded, no DOM or Node API; the same input gives the
// same output.
//
// Where this is not the original, each said again where it happens:
//  - the random initial fields come from another generator (pcg32 there), so
//    the output is not the native program's quad for quad, only in kind;
//  - vertices are renumbered along a Z-order curve and the coarse levels in
//    the order of their first fine vertex (dedge.ts, hierarchy.ts): speed only;
//  - constraint directions are merged down the hierarchy as lines, not as
//    crosses, and the coarse position constraints are put onto their tangent
//    planes as was meant (hierarchy.ts): boundaries, and independence of
//    where the scan lies in space;
//  - the position field is solved again at a corrected scale when the count
//    of quads is more than 3 % off the target (below);
//  - the scan is hit with rays through a uniform grid, not a BVH (extract.ts);
//  - the final clean-up is Quick Scan's own (cleanup.ts);
//  - doubles throughout (floats there); no intrinsic mode, no 2- or 6-RoSy,
//    no triangle output, no point clouds, no adaptive sizing.

import { cleanQuads } from './cleanup'
import { triangles } from '../cage'
import { coverageProbes, scanCoverage } from '../scanCoverage'
import { buildDedge, dualVertexAreas, meshStats, reorderForLocality, subdivide, uniformAdjacency, vertexNormals } from './dedge'
import type { TriMesh } from './dedge'
import { RayGrid, extractFaces, extractGraph } from './extract'
import { countOrientationSingularities, optimizeOrientations, optimizePositions } from './field'
import { buildHierarchy, clearConstraints, propagateConstraints, randomOrientations, randomPositions } from './hierarchy'
import { INVALID, Progress, now } from './util'
import type { InstantStage } from './util'

export interface InstantInput {
  /** xyz per vertex, welded */
  positions: Float32Array | Float64Array
  /** 3 per triangle */
  indices: Uint32Array
}

export interface InstantOptions {
  /** Target number of QUADS in the output (pure-quad). Converted here to Instant Meshes' scale (its pure-quad output has about four times the faces it is asked for). */
  quads: number
  /** Align the field to open boundaries (IM -b). Default true. */
  boundaries?: boolean
  /** Dihedral crease angle in degrees (IM -c); undefined = smooth normals. */
  creaseAngle?: number
  /** Extra orientation constraints: per input vertex, a tangent direction and a weight 0..1 (CQ/CQw), and a point the lattice is to pass through when `position` is given (CO/COw). */
  constraints?: { vertex: number; direction: [number, number, number]; position?: [number, number, number]; weight?: number }[]
  /** Per-vertex relative target edge scale. NOT SUPPORTED: accepted and ignored (Instant Meshes' field has one scale). */
  sizing?: Float32Array
  /** Smoothing + reprojection iterations (IM -S), default 2. */
  smooth?: number
  /** Seed of the random initial fields. Default 0. */
  seed?: number
  /** Called often with a stage name and a 0..1 fraction; whatever it throws propagates (that is how the caller cancels). */
  progress?: (stage: InstantStage, fraction: number) => void
}

export interface InstantResult {
  /** xyz per output vertex */
  positions: Float64Array
  /** every face has exactly 4 vertices, wound alike, outwards */
  faces: number[][]
  /** The edge length the quads were laid at: half the lattice step of the field (Instant Meshes' own "edge length" is that step — its pure-quad output subdivides every cell once). */
  scale: number
  /** orientation-field singularity count */
  singularities: number
  /** A coarse closed part needed a newly prepared, finer field to recover its topology. */
  topologyResolutionRaised?: boolean
  stats: {
    quads: number
    boundaryEdges: number
    /** Vertices off the boundary that do not have four edges. */
    irregular: number
    components: number
    /** Milliseconds in prepare, hierarchy, orientation, position, extract and smooth, and in total; and `attempts`: how many times the position field was solved (a count). */
    msByStage: Record<string, number>
  }
}

/**
 * How far from the target the count may be before the position field is
 * solved again at a corrected scale: after the first solve, and after the
 * second. Each further solve costs about half of the whole run again; the
 * count of one scale varies by a couple of per cent with the seed, so a
 * tighter second limit would mostly buy a third solve.
 */
const COUNT_TOLERANCE = [0.03, 0.045]
const MAX_ATTEMPTS = 3

export function instantQuads(input: InstantInput, options: InstantOptions): InstantResult {
  return solveField(input, options, true)
}

function solveField(input: InstantInput, options: InstantOptions, allowRestart: boolean): InstantResult {
  const progress = new Progress(options.progress)
  const ms: Record<string, number> = { prepare: 0, hierarchy: 0, orientation: 0, position: 0, extract: 0, smooth: 0 }
  let clock = now()
  const lap = (stage: string): void => {
    const t = now()
    ms[stage] += t - clock
    clock = t
  }
  const started = clock
  const target = Math.max(4, Math.floor(options.quads))
  const seed = options.seed ?? 0
  const smooth = Math.max(0, Math.floor(options.smooth ?? 2))
  const empty = (scale: number, singularities: number): InstantResult => {
    ms.total = now() - started
    return { positions: new Float64Array(0), faces: [], scale: scale / 2, singularities, stats: { quads: 0, boundaryEdges: 0, irregular: 0, components: 0, msByStage: ms } }
  }

  // ---- prepare
  progress.report('prepare', 0)
  const nVIn = Math.floor(input.positions.length / 3)
  let mesh: TriMesh = {
    V: Float64Array.from(input.positions.subarray(0, nVIn * 3)),
    nV: nVIn,
    F: input.indices.slice(0, Math.floor(input.indices.length / 3) * 3),
    nF: Math.floor(input.indices.length / 3),
  }
  for (let k = 0; k < mesh.V.length; k++) if (!Number.isFinite(mesh.V[k])) throw new Error('instantQuads: a vertex is not finite')
  for (let k = 0; k < mesh.F.length; k++) if (mesh.F[k] >= nVIn) throw new Error('instantQuads: the mesh refers to a vertex that does not exist')
  const stats = meshStats(mesh.F, mesh.nF, mesh.V)
  if (mesh.nF === 0 || !(stats.surfaceArea > 0)) return empty(0, 0)
  // batch.cpp: face_count → scale; the pure-quad output has four times face_count.
  let scale = Math.sqrt(stats.surfaceArea / (target / 4))
  progress.report('prepare', 0.1)
  /** Per vertex of the input: its index after the first renumbering, when there was one (the subdivision appends, so it keeps them). */
  let inputIndex: Uint32Array | null = null
  if (stats.maximumEdgeLength * 2 > scale || stats.maximumEdgeLength > stats.averageEdgeLength * 2) {
    // The first numbering also serves the subdivision, which works across neighbours.
    const first = reorderForLocality(mesh, progress.part('prepare', 0.1, 0.15))
    const dedge = buildDedge(first.mesh.F, first.mesh.nF, first.mesh.nV, progress.part('prepare', 0.15, 0.3))
    mesh = subdivide(first.mesh, dedge, Math.min(scale / 2, stats.averageEdgeLength * 2), progress.part('prepare', 0.3, 0.4))
    inputIndex = first.newIndex
  }
  const reordered = reorderForLocality(mesh, progress.part('prepare', 0.4, 0.45))
  const { F, nF, V, nV } = reordered.mesh
  const dedge = buildDedge(F, nF, nV, progress.part('prepare', 0.45, 0.6))
  const adj = uniformAdjacency(F, nV, dedge, progress.part('prepare', 0.6, 0.7))
  const { N, crease } = vertexNormals(F, nF, V, nV, dedge, options.creaseAngle, progress.part('prepare', 0.7, 0.85))
  const A = dualVertexAreas(F, V, nV, dedge, progress.part('prepare', 0.85, 1))
  progress.report('prepare', 1)
  lap('prepare')

  // ---- hierarchy
  progress.report('hierarchy', 0)
  const hierarchy = buildHierarchy(V, N, A, adj, nV, seed, progress)
  randomOrientations(hierarchy, seed, progress.part('hierarchy', 0.95, 1))
  const level0 = hierarchy.levels[0]

  // Constraints: open boundaries (batch.cpp, -b), then the caller's.
  const alignBoundaries = options.boundaries ?? true
  const closedInput = !dedge.E2E.includes(INVALID)
  // A closed triangular manifold has 3F/2 edges. A closed quad manifold has 2F.
  const inputEuler = closedInput ? new Set(F).size - nF / 2 : 0
  const anyBoundary = alignBoundaries && !closedInput
  const constraints = options.constraints ?? []
  if (anyBoundary || constraints.length > 0) {
    clearConstraints(hierarchy)
    const { CQ, CO, CQw, COw } = level0
    if (anyBoundary) {
      for (let e = 0; e < nF * 3; e++) {
        if (dedge.E2E[e] !== INVALID) continue
        const f = (e / 3) | 0, k = e - 3 * f
        const i0 = F[e], i1 = F[3 * f + (k + 1) % 3]
        let ex = V[3 * i1] - V[3 * i0], ey = V[3 * i1 + 1] - V[3 * i0 + 1], ez = V[3 * i1 + 2] - V[3 * i0 + 2]
        const len2 = ex * ex + ey * ey + ez * ez
        if (!(len2 > 0)) continue
        const inv = 1 / Math.sqrt(len2)
        ex *= inv; ey *= inv; ez *= inv
        for (const v of [i0, i1]) {
          CO[3 * v] = V[3 * v]; CO[3 * v + 1] = V[3 * v + 1]; CO[3 * v + 2] = V[3 * v + 2]
          CQ[3 * v] = ex; CQ[3 * v + 1] = ey; CQ[3 * v + 2] = ez
          CQw[v] = 1
          COw[v] = 1
        }
      }
    }
    for (const c of constraints) {
      if (!Number.isInteger(c.vertex) || c.vertex < 0 || c.vertex >= nVIn) continue
      const v = reordered.newIndex[inputIndex ? inputIndex[c.vertex] : c.vertex]
      const w = Math.min(1, Math.max(0, c.weight ?? 1))
      if (w === 0) continue
      // Into the tangent plane, as a stroke's direction is.
      const nx = N[3 * v], ny = N[3 * v + 1], nz = N[3 * v + 2]
      let dx = c.direction[0], dy = c.direction[1], dz = c.direction[2]
      const d = dx * nx + dy * ny + dz * nz
      dx -= d * nx; dy -= d * ny; dz -= d * nz
      const len = Math.hypot(dx, dy, dz)
      if (!(len > 1e-12)) continue
      CQ[3 * v] = dx / len; CQ[3 * v + 1] = dy / len; CQ[3 * v + 2] = dz / len
      CQw[v] = w
      if (c.position) {
        CO[3 * v] = c.position[0]; CO[3 * v + 1] = c.position[1]; CO[3 * v + 2] = c.position[2]
        COw[v] = w
      } else COw[v] = 0
    }
    propagateConstraints(hierarchy, scale)
  }
  progress.report('hierarchy', 1)
  lap('hierarchy')

  // ---- orientation field
  progress.report('orientation', 0)
  optimizeOrientations(hierarchy, progress)
  const singularities = countOrientationSingularities(hierarchy, F, nF, progress)
  lap('orientation')

  // ---- position field and extraction; again at a corrected scale when the count is off.
  let grid: RayGrid | null = null
  let best: { clean: ReturnType<typeof cleanQuads>; scale: number; error: number; incomplete: boolean } | null = null
  let scanSamples: Float32Array | undefined
  const coverage = (c: { positions: Float64Array; faces: number[][] }) => {
    scanSamples ??= coverageProbes({ positions: Float32Array.from(input.positions), indices: input.indices }, 128)
    const indices = triangles({ ...c, creases: [] })
    return scanCoverage(scanSamples, { positions: Float32Array.from(c.positions), indices }, 0)
  }
  let sawWrongTopology = false
  ms.attempts = 0
  for (let attempt = 0; attempt < MAX_ATTEMPTS + 1; attempt++) {
    if (attempt === MAX_ATTEMPTS && (!best?.incomplete || !closedInput || target > 2000)) break
    ms.attempts++
    progress.report('position', 0)
    randomPositions(hierarchy, scale, seed, progress.part('position', 0, 0))
    if (attempt > 0 && hierarchy.hasConstraints) propagateConstraints(hierarchy, scale)
    optimizePositions(hierarchy, scale, progress)
    lap('position')

    progress.report('extract', 0)
    if (smooth > 0 && grid === null) grid = new RayGrid(V, F, nF, scale / 4, progress.part('extract', 0, 0))
    const graph = extractGraph(level0, crease, scale, progress)
    lap('extract')
    const extracted = extractFaces(graph, scale, smooth, grid, progress, anyBoundary)
    const clean = cleanQuads(extracted.positions, extracted.normals, extracted.quads, extracted.nV)
    lap('smooth')
    const count = clean.faces.length
    const countError = Math.abs(count - target) / target
    const wrongTopology = closedInput && (clean.boundaryEdges > 0 || clean.positions.length / 3 - count !== inputEuler)
    sawWrongTopology ||= wrongTopology
    const incomplete = count === 0 || wrongTopology
    let error = countError
    if (closedInput && incomplete) {
      // A fragment can have the requested count yet omit most of a thin ring.
      // Compare incomplete candidates against identical area-weighted scan probes.
      error = Infinity
      if (count > 0) {
        error = coverage(clean).rms
      }
    }
    if (!best || (best.incomplete && !incomplete) || (best.incomplete === incomplete && error < best.error)) {
      best = { clean, scale, error, incomplete }
    }
    if (!incomplete && error <= COUNT_TOLERANCE[Math.min(attempt, COUNT_TOLERANCE.length - 1)]) break
    // Nothing at all: the lattice is too coarse for the scan to hold a cell of it.
    const correction = count === 0 ? 0.6 : Math.sqrt(count / target)
    // On a closed input, a hole can mean too few cells cross a narrow wall.
    // Try a finer grid even when the surviving face count meets the target.
    scale *= incomplete ? Math.min(0.7, Math.max(0.5, correction)) : correction
  }
  if (allowRestart && closedInput && target <= 2000 && (sawWrongTopology || !best?.clean.faces.length)) {
    const previous = best?.clean.faces.length ? coverage(best.clean) : { rms: Infinity, max: Infinity }
    if (!best || best.incomplete || previous.max > best.scale) {
      // Changing spacing in an already prepared hierarchy cannot restore
      // cross-section detail discarded at its coarse working resolution.
      // Keep the first covering, genus-preserving result. Very slender sections
      // can still span fewer than three cells in the first replacement field.
      for (const multiplier of [5, 10, 20]) {
        const resolution = target * multiplier
        if (resolution > 10000) break
        const finer = solveField(input, { ...options, quads: resolution }, false)
        for (const stage of Object.keys(ms)) ms[stage] += finer.stats.msByStage[stage] ?? 0
        if (!finer.faces.length || finer.stats.boundaryEdges !== 0 || finer.positions.length / 3 - finer.faces.length !== inputEuler) continue
        const next = coverage(finer)
        if (next.rms <= previous.rms && next.max <= previous.max) {
          ms.total = now() - started
          return { ...finer, topologyResolutionRaised: true, stats: { ...finer.stats, msByStage: ms } }
        }
      }
    }
  }
  if (best === null || best.clean.faces.length === 0) return empty(scale, singularities)
  ms.total = now() - started
  const { clean } = best
  return {
    positions: clean.positions,
    faces: clean.faces,
    scale: best.scale / 2,
    singularities,
    stats: {
      quads: clean.faces.length, boundaryEdges: clean.boundaryEdges, irregular: clean.irregular,
      components: clean.components, msByStage: ms,
    },
  }
}
