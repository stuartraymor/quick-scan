// SPDX-License-Identifier: AGPL-3.0-only
import type { Vec3 } from '../../../src/core/types'
import { boxOnSheet, sketchFrameOn } from '../../../src/core/section/frame'
import { addScaled } from '../../../src/core/vec'
import { diagonalOf, meshDeflection, type TrimPiece, type TrimReport } from './buildTypes'
import { rectangleLoop } from './loops'
import type { ReKernel, Shape } from './kernel'

/** Carry a touching, short plane across the target only when its finite edge
 * ends inside the target. Disjoint sheets and coplanar overlaps are left alone. */
export function trimSheetPieces(k: ReKernel, sheet: Shape, tools: Shape[], tolerance = 1e-5) {
  const finite = k.sheetPieces(sheet, tools, tolerance)
  if (finite.length > 1 && tools.length === 1) return finite
  const extended: Shape[] = []
  try {
    const cutters = tools.map(tool => {
      const plane = k.trimPlane(tool)
      if (!plane || k.distanceBetween(tool, sheet) > 1e-5) return tool
      if (finite.length > 1) {
        const alone = k.sheetPieces(sheet, [tool], tolerance)
        const reaches = alone.length > 1
        k.release(...alone)
        if (reaches) return tool
      }
      const frame = sketchFrameOn({ origin: plane.centroid, normal: plane.dir })
      if (!frame) return tool
      const { min, max } = boxOnSheet(frame, k.bounds(sheet))
      if (min[2] >= -1e-5 || max[2] <= 1e-5) return tool
      const corner = addScaled(addScaled(frame.origin, frame.basisU, min[0] - 1), frame.basisV, min[1] - 1)
      const carried = k.face({ outer: rectangleLoop(corner, frame.basisU, frame.basisV, max[0]-min[0]+2, max[1]-min[1]+2), holes: [] })
      extended.push(carried)
      return carried
    })
    if (!extended.length) return finite
    const split = k.sheetPieces(sheet, cutters, tolerance)
    k.release(...finite)
    return split
  } catch (error) { k.release(...finite); throw error }
  finally { k.release(...extended) }
}

export function previewTrimPiece(k: ReKernel, shape: Shape, body: number, removed: boolean, picks: number[]): TrimPiece | null {
  const at = k.interiorPoint(shape)
  return at ? { body, at, removed, picks, mesh: k.mesh(shape, meshDeflection(diagonalOf(k, shape))) } : null
}

/** Keep topology references out of the file. A saved pick identifies a fragment
 * by its source body and a point inside it, even after the kernel renumbers faces. */
export function mutualTrim(k: ReKernel, sheets: { id: number; shape: Shape }[], removed: { body: number; at: Vec3 }[], preview = false, mergeFaces = true) {
  if (sheets.length < 2) throw new Error('Select at least two intersecting sheets.')
  const owned: Shape[] = []
  const kept: Shape[] = []
  const fragments: TrimPiece[] = []
  let count = 0
  let split = false
  try {
    for (const sheet of sheets) {
      const pieces = trimSheetPieces(k, sheet.shape, sheets.filter(s => s !== sheet).map(s => s.shape))
      owned.push(...pieces)
      count += pieces.length
      split ||= pieces.length > 1
      const excluded = new Map<number, number[]>()
      for (const [pickIndex, pick] of removed.entries()) {
        if (pick.body !== sheet.id) continue
        const ranked = pieces.map((s, index) => ({ index, distance: k.distanceToPoint(s, pick.at) })).sort((a, b) => a.distance - b.distance)
        if (!ranked.length || ranked[0].distance > 0.15 || (ranked[1] && ranked[1].distance - ranked[0].distance < 1e-5)) {
          throw new Error('A removed-piece pick is outside the sheet or on a cut edge. Remove that pick and click inside the piece.')
        }
        const index = ranked[0].index
        excluded.set(index, [...(excluded.get(index) ?? []), pickIndex])
      }
      pieces.forEach((piece, i) => {
        const picks = excluded.get(i)
        if (!picks) kept.push(piece)
        if (preview) {
          const fragment = previewTrimPiece(k, piece, sheet.id, !!picks, picks ?? [])
          if (fragment) fragments.push(fragment)
        }
      })
    }
    if (!split) throw new Error('The sheets do not cut one another into pieces. Extend a sheet across its neighbour.')
    if (!kept.length) throw new Error('Keep at least one piece.')
    const shape = mergeFaces ? k.sewFaces(kept, 1e-5) : k.sewPatches(kept, 1e-5, true)
    try {
      const closed = k.isClosedSolid(shape)
      const openEdges = closed ? [] : k.openEdgePolylines(shape, 0.05)
      const report: TrimReport = { faces: count, kept: kept.length, closed, openEdges, ...(preview && fragments.length === count ? { pieces: fragments } : {}) }
      return { shape, report, surface: !closed }
    } catch (error) { k.release(shape); throw error }
  } finally { k.release(...owned) }
}
