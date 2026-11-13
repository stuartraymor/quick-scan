// SPDX-License-Identifier: AGPL-3.0-only
// The 3-2-1 alignment being set up, as data: its draft, the proposal a search
// hands it, what each slot holds, and the preview of where the part would go.
// The actions that change it are the store's.

import { AlignmentError, type AlignSlot, type AxisDir, axisIndex, computeDatumAlignment, describeRigid, fitFromAlignPicks, hasDatumDirection, sameDatum, secondaryAlongPrimary, secondaryRole, tertiaryTileKind, translationToOrigin } from '../core/alignment'
import type { Rigid } from '../core/deviation/rigid'
import type { FitData, Vec3 } from '../core/types'
import type { Element } from './elementModel'
import { providesRole } from '../core/elements/refs'
import { orthoBasis } from '../core/fit/linalg'
import { dot, normalize } from '../core/vec'

/** The 3-2-1 alignment being set up: per slot either an existing element or
 *  points picked straight on the scan (3 span the levelling plane, 2 the
 *  rotation line, 1 the origin), plus the global axis each direction becomes.
 *  Nothing moves until it is applied. */
export interface AlignDraft {
  /** Explicit viewport-reference target, separate from raw scan-point picking. */
  referencePickSlot?: AlignSlot | null
  primary: number | null
  primaryPicks: Vec3[]
  /** Surface normal at each primary pick, so the levelling plane knows which
   *  side of it is outside the part — see fitFromAlignPicks. */
  primaryPickNormals: Vec3[]
  primaryAxis: AxisDir
  secondary: number | null
  secondaryPicks: Vec3[]
  secondaryAxis: AxisDir
  origin: number | null
  originPicks: Vec3[]
  /** The slot currently collecting clicks on the scan, or null. */
  pickSlot: AlignSlot | null
  /** What an automatic proposal read off the scan, in a sentence — there
   *  while the slots hold what it filled in, gone once one is filled by hand. */
  proposal?: string
  /** QUICKSURFACE's "Don't move the coordinate system to the centre of the
   *  primitive": with no zero point chosen, the part is only turned, about
   *  the world origin, and not moved onto the features. */
  keepOrigin?: boolean
  /** The tertiary tile chosen (Top / Right / Front for a plane, X / Y / Z
   *  Axis for an axis), always the positive side; unset, or a tile that is
   *  greyed, means the first tile available — see tertiaryTiles. */
  tertiaryAxis?: AxisDir
  /** The tertiary row's Flip: the tile's axis taken on its negative side. */
  tertiaryFlip?: boolean
  /** The secondary row's greyed tile (0, 1, 2 for x, y, z): the primary's
   *  axis when the secondary was chosen. QUICKSURFACE 8.0.128 works it out
   *  then and leaves it when the primary's tile changes afterwards, so the
   *  primary's new axis can be clicked there (and the secondary is then
   *  ignored) while its old one stays grey (align sweeps 1 and 3: h14, m7,
   *  b7, b18). Unset: the primary's current axis. */
  secondaryGreyAxis?: number
}

/** QUICKSURFACE's tertiary row (8.0.128, controlled fixtures 2026-11-11;
 *  align sweep 2, 2026-11-12): which tiles it shows, which are available and
 *  whether the choice turns the part. With no secondary, or one it ignores
 *  (see secondaryRole), the tiles are greyed and the tertiary is not used;
 *  with a secondary that clocks the rotation a plane's tiles stay available
 *  but change nothing, and an axis's are greyed; after a 'cap' or point
 *  secondary the tertiary clocks the rotation, and only the tile on the
 *  primary's axis is greyed. After a point primary the secondary stands in
 *  for the primary. A point tertiary has no tiles. */
export interface TertiaryTiles {
  kind: 'plane' | 'axis' | null
  /** Tile axes in QUICKSURFACE's order. */
  order: AxisDir[]
  /** Whether the tile for each global axis (x, y, z) can be chosen. */
  enabled: [boolean, boolean, boolean]
  clocks: boolean
}

const PLANE_ORDER: AxisDir[] = ['z+', 'x+', 'y+']
const AXIS_ORDER: AxisDir[] = ['x+', 'y+', 'z+']

export function tertiaryTiles(primary: FitData | null, secondary: FitData | null, tertiary: FitData | null, primaryAxis: AxisDir, secondaryAxis?: AxisDir): TertiaryTiles {
  const kind = tertiary ? tertiaryTileKind(tertiary) : null
  const order = kind === 'axis' ? AXIS_ORDER : PLANE_ORDER
  const none = { kind, order, enabled: [false, false, false] as [boolean, boolean, boolean], clocks: false }
  if (!kind || !primary || !secondary || !tertiary) return none
  // The primary chosen again: ignored, its tiles greyed (align sweep 3, h2).
  if (sameDatum(tertiary, primary)) return none
  const clocking = (axis: AxisDir, by: FitData) => ({ kind, order, enabled: [0, 1, 2].map((i) => i !== axisIndex(axis)) as [boolean, boolean, boolean], clocks: !secondaryAlongPrimary(by, tertiary) })
  if (!hasDatumDirection(primary)) return hasDatumDirection(secondary) && secondaryAxis ? clocking(secondaryAxis, secondary) : none
  const role = secondaryRole(primary, primaryAxis, secondary, secondaryAxis)
  // After a turning secondary the tiles turn nothing. A plane's are
  // available. An axis's are available when it stands well off a primary
  // plane (68° and 90° measured) and greyed when it lies near it (0° and 5°);
  // after an axis primary, available unless it runs the primary's way (align
  // sweep 3: c13, d9, f2, f3, f8 available, d8 and f1 greyed; 0.0.208's
  // cylinder 5° off the plane greyed). Where between 5° and 68° QUICKSURFACE
  // changes over was not measured; 45° is taken.
  if (role === 'turns') {
    const dir = tertiary.kind === 'line' ? tertiary.dir : tertiary.kind === 'cylinder' || tertiary.kind === 'cone' ? tertiary.axis : null
    const a = dir ? normalize(dir) : null, n = primary.kind === 'plane' ? normalize(primary.normal) : null
    const offered = kind === 'plane' || (!!a && (n ? Math.abs(dot(a, n)) > Math.SQRT1_2 : !secondaryAlongPrimary(primary, tertiary)))
    return offered ? { ...none, enabled: [true, true, true] } : none
  }
  if (role === 'cap' || role === 'point') return clocking(primaryAxis, primary)
  return none
}

/** The tile shown chosen: the one picked if it is available, else the first
 *  available, else none. Always the positive side. */
export function chosenTertiaryTile(ad: Pick<AlignDraft, 'tertiaryAxis'>, tiles: TertiaryTiles): AxisDir | null {
  if (ad.tertiaryAxis && tiles.enabled[axisIndex(ad.tertiaryAxis)]) return ad.tertiaryAxis
  return tiles.order.find((a) => tiles.enabled[axisIndex(a)]) ?? null
}

/** The axis the tertiary's direction becomes, or null when it does not turn
 *  the part. */
export function tertiaryTurnAxis(ad: Pick<AlignDraft, 'tertiaryAxis' | 'tertiaryFlip'>, tiles: TertiaryTiles): AxisDir | null {
  const tile = tiles.clocks ? chosenTertiaryTile(ad, tiles) : null
  return tile && ad.tertiaryFlip ? flippedAlignmentAxis(tile) : tile
}

/** A proposed alignment as the picks of the three slots — see
 *  core/autoAlign autoAlignPicks. */
export interface AlignmentProposal {
  primary: Vec3[]
  primaryNormals: Vec3[]
  secondary: Vec3[]
  origin: Vec3
}

export function alignSlotPicks(ad: AlignDraft, slot: AlignSlot): Vec3[] {
  return slot === 'primary' ? ad.primaryPicks : slot === 'secondary' ? ad.secondaryPicks : ad.originPicks
}

/** The point a datum alignment centres on the origin, or null for none: only
 *  the *first* alignment centres, because a part fresh from the scanner sits
 *  at an arbitrary offset nobody wants to keep — while a part that has already
 *  been aligned or moved is exactly where its user put it. */
export function alignCenterOf(s: {
  appliedAlignment: Rigid | null
  modelCenter: Vec3
}): Vec3 | null {
  return s.appliedAlignment === null ? s.modelCenter : null
}

/** What an alignment draft would do to the part right now: the transform and
 *  how far it moves, or why it cannot be computed yet. Read by the panel for
 *  its preview numbers and by the viewport for the live preview, so the two
 *  can never disagree. Null with no error means the levelling slot is still
 *  empty — there is nothing to say yet. */
export interface AlignPreview {
  rigid: Rigid
  rotationDeg: number
  translation: number
}

/** What a slot holds as a fit: its element's, or one made from its picks;
 *  null while it is not filled. Throws AlignmentError for a reference that
 *  is gone or picks that make no datum. */
function alignSlotFit(ad: AlignDraft, elements: Element[], modelSize: number, slot: AlignSlot, ref: number | null): FitData | null {
  if (ref !== null) {
    const element = alignmentReferences(elements).find((e) => e.id === ref)
    if (!element || !alignmentSlotAccepts(slot, element)) throw new AlignmentError('The ' + slot + ' reference is unavailable. Select another reference.')
    return element.fit!
  }
  return fitFromAlignPicks(slot, alignSlotPicks(ad, slot), modelSize, slot === 'primary' ? ad.primaryPickNormals : undefined)
}

/** The tertiary row for a draft, from the same fits the preview uses. */
export function alignDraftTertiaryTiles(ad: AlignDraft, elements: Element[], modelSize: number): TertiaryTiles {
  const fit = (slot: AlignSlot, ref: number | null) => { try { return alignSlotFit(ad, elements, modelSize, slot, ref) } catch { return null } }
  return tertiaryTiles(fit('primary', ad.primary), fit('secondary', ad.secondary), fit('origin', ad.origin), ad.primaryAxis, ad.secondaryAxis)
}

export function alignmentPreview(
  ad: AlignDraft,
  elements: Element[],
  modelSize: number,
  centerOf: Vec3 | null = null,
): { preview: AlignPreview | null; error: string | null } {
  const slotFit = (slot: AlignSlot, ref: number | null) => alignSlotFit(ad, elements, modelSize, slot, ref)
  try {
    const primary = slotFit('primary', ad.primary)
    if (!primary) {
      // A zero point on its own is a valid alignment: the part keeps its
      // orientation and that point becomes 0, 0, 0.
      const origin = slotFit('origin', ad.origin)
      if (!origin) return { preview: null, error: null }
      const rigid = translationToOrigin(origin.center)
      return { preview: { rigid, ...describeRigid(rigid) }, error: null }
    }
    const secondary = slotFit('secondary', ad.secondary)
    // With a primary and no secondary QUICKSURFACE ignores the tertiary
    // altogether — plane, axis or point, and its Flip (8.0.128, controlled
    // fixtures 2026-11-11: the part lands on the primary alone). A tertiary
    // on its own, with no primary, still moves the zero point (above).
    const origin = secondary ? slotFit('origin', ad.origin) : null
    const rigid = computeDatumAlignment(
      { fit: primary, axis: ad.primaryAxis },
      secondary ? { fit: secondary, axis: ad.secondaryAxis } : null,
      origin,
      centerOf,
      tertiaryTurnAxis(ad, tertiaryTiles(primary, secondary, origin, ad.primaryAxis, ad.secondaryAxis)),
    )
    if (ad.keepOrigin && !origin) rigid.t.fill(0)
    return { preview: { rigid, ...describeRigid(rigid) }, error: null }
  } catch (e) {
    return {
      preview: null,
      error: e instanceof AlignmentError ? e.message : 'Alignment failed.',
    }
  }
}

/** The slot with the given element reference and its picks discarded — the
 *  two ways of filling a slot are exclusive. */
export function withSlotRef(ad: AlignDraft, slot: AlignSlot, id: number | null): AlignDraft {
  const base = { ...ad, referencePickSlot: null, pickSlot: ad.pickSlot === slot ? null : ad.pickSlot, proposal: undefined }
  if (slot === 'primary')
    return { ...base, primary: id, primaryPicks: [], primaryPickNormals: [] }
  if (slot === 'secondary') return { ...base, secondary: id, secondaryPicks: [] }
  return { ...base, origin: id, originPicks: [] }
}

/** The tile QUICKSURFACE starts a secondary on: Front for a plane, X Axis
 *  for a cylinder, cone or line (align sweep, 2026-11-11: Quick Scan started
 *  a cylinder on Y Axis and the part came out turned 90°). */
export function defaultSecondaryAxis(fit: FitData | undefined, current: AxisDir, primaryAxis: AxisDir, primary?: FitData | null): AxisDir {
  if (!fit) return current
  // After a sphere or point primary, which has no tiles, a plane starts on
  // Top (align sweep 3: e6, e9, g7, g8 — Sphere(1) or Origin, then a plane).
  if (primary && !hasDatumDirection(primary) && fit.kind === 'plane') return 'z+'
  // A plane starts on Front after a Top primary and on Top otherwise; an
  // axis on X Axis, or Z Axis after a primary on X (align sweeps: Front
  // primary → plane on Top; Right primary → cylinder on Z Axis; sweep 3's
  // tile probes: Right primary → plane on Top).
  if (fit.kind === 'plane') return primaryAxis[0] === 'z' ? 'y+' : 'z+'
  if (fit.kind === 'cylinder' || fit.kind === 'cone' || fit.kind === 'line') return primaryAxis[0] === 'x' ? 'z+' : 'x+'
  return current
}

/** The draft after the primary's tile changes to `axis` (always positive:
 *  a tile clears the primary's Flip). QUICKSURFACE 8.0.128 then puts the
 *  secondary back on its starting tile and greys a tile in its row — both
 *  worked out from the primary's tile *before* the change; the secondary's
 *  Flip stays (align sweep 3's tile probes g1–g13, and h14, m7, b7, b18). A
 *  secondary running the primary's way keeps its tile. */
export function withPrimaryTile(ad: AlignDraft, axis: AxisDir, elements: Element[]): AlignDraft {
  const old = ad.primaryAxis
  const next = { ...ad, primaryAxis: axis }
  if (axisIndex(old) === axisIndex(axis) || ad.secondary === null) return next
  const refs = alignmentReferences(elements)
  const fit = refs.find((e) => e.id === ad.secondary)?.fit
  const primary = ad.primary === null ? null : refs.find((e) => e.id === ad.primary)?.fit ?? null
  if (!fit || (primary && secondaryAlongPrimary(primary, fit))) return next
  const tile = defaultSecondaryAxis(fit, ad.secondaryAxis, old, primary)
  return { ...next, secondaryAxis: alignmentTileAxis(ad.secondaryAxis, tile), secondaryGreyAxis: axisIndex(old) }
}

/** A slot filled with an element, the secondary starting on its default tile. */
export function withSlotElement(ad: AlignDraft, slot: AlignSlot, id: number | null, elements: Element[]): AlignDraft {
  const next = withSlotRef(ad, slot, id)
  // Another primary in place of one starts on Top (Z Axis for an axis), its
  // Flip off; the secondary's row is left as it was (align sweep 3's tile
  // probes g1, g12). The first one keeps the tile the dialog opened on.
  if (slot === 'primary' && id !== null && ad.primary !== null && id !== ad.primary) return { ...next, primaryAxis: 'z+' }
  if (slot !== 'secondary' || id === null) return next
  const refs = alignmentReferences(elements)
  const fit = refs.find((e) => e.id === id)?.fit
  const primary = next.primary === null ? null : refs.find((e) => e.id === next.primary)?.fit ?? null
  // The secondary's Flip stays when another feature is chosen there (align
  // sweep 3's tile probe g13).
  return { ...next, secondaryAxis: alignmentTileAxis(next.secondaryAxis, defaultSecondaryAxis(fit, next.secondaryAxis, next.primaryAxis, primary)), secondaryGreyAxis: axisIndex(next.primaryAxis) }
}

/** The secondary tile greyed for a draft: see AlignDraft.secondaryGreyAxis. */
export function secondaryGreyedTile(ad: Pick<AlignDraft, 'primaryAxis' | 'secondaryGreyAxis'>): number {
  return ad.secondaryGreyAxis ?? axisIndex(ad.primaryAxis)
}

export function withSlotPicks(
  ad: AlignDraft,
  slot: AlignSlot,
  picks: Vec3[],
  normals: Vec3[] = [],
): AlignDraft {
  const base = { ...ad, proposal: undefined }
  if (slot === 'primary')
    return { ...base, primary: null, primaryPicks: picks, primaryPickNormals: normals }
  if (slot === 'secondary') return { ...base, secondary: null, secondaryPicks: picks }
  return { ...base, origin: null, originPicks: picks }
}

// Negative IDs are reserved for immutable alignment datums; document objects
// allocate positive IDs. These datums never enter the model/history or move
// when alignment is applied.
const stats = { sigma: 0, usedPoints: 0, regionSize: 0 }
export function alignmentReferences(elements: Element[]): Element[] {
  const datums: Element[] = []
  const directions: Vec3[] = [[1,0,0],[0,1,0],[0,0,1]]
  const common={color:'#888888', status:'done' as const, visible:true, source:{type:'picked' as const}}
  // QUICKSURFACE's list: Top, Right, Front, then X, Y and Z Axis, then Origin.
  for (const i of [2,0,1]) {
    const normal=directions[i], [basisU,basisV]=orthoBasis(normal)
    datums.push({...common,id:-1001-i,kind:'plane',name:['Right','Front','Top'][i],
      fit:{...stats,kind:'plane',center:[0,0,0],normal,basisU,basisV,extentU:100,extentV:100}})
  }
  for (let i=0;i<3;i++) {
    datums.push({...common,id:-1011-i,kind:'line',name:['X Axis','Y Axis','Z Axis'][i],
      fit:{...stats,kind:'line',center:[0,0,0],dir:directions[i],length:200}})
  }
  datums.push({id:-1020,kind:'point',name:'Origin',color:'#888888',status:'done',visible:true,
    source:{type:'picked'},fit:{...stats,kind:'point',center:[0,0,0]}})
  return [...datums,...elements]
}

export function alignmentSlotAccepts(slot: AlignSlot, element: Element): boolean {
  // The tertiary (zero point) takes any feature, as QUICKSURFACE lists them
  // all: a point, or the centre of a plane, axis or other primitive.
  // QUICKSURFACE lists every feature in all three rows (align sweep 2,
  // 2026-11-12): a sphere or point primary moves its centre to the origin, a
  // point secondary sets the coordinates still open.
  return Boolean(element.fit) && (slot === 'origin' ? true
    : providesRole(element.kind,'plane') || providesRole(element.kind,'axis') || providesRole(element.kind,'point'))
}

export function flippedAlignmentAxis(axis: AxisDir): AxisDir {
  return (axis[0] + (axis[1] === '+' ? '-' : '+')) as AxisDir
}

/** Top, Right and Front use positive normals. Preserve Flip across target changes. */
export function alignmentTileAxis(current: AxisDir, tile: AxisDir): AxisDir {
  return current[1] === '+' ? tile : flippedAlignmentAxis(tile)
}
