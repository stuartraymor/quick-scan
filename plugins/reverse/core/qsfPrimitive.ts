// SPDX-License-Identifier: AGPL-3.0-only
// The primitives QUICKSURFACE 8 fits on a scan (Extract Primitives), as its
// project file holds them. Read from 42 records in the QUICKSURFACE projects
// saved in this campaign (2026-11-11), against the values those projects
// were built to: a record is its object header, its name, the GUID again, a
// fixed block of 0x47efffffe0000000 ("unset") doubles — one per number the
// primitive has, as a plane's — then its fit RMS, 0xffffffff 0, the numbers,
// and one zero double.
//
// - cylinder (10): a point on the axis where the surface starts, the unit
//   axis, the radius, the length — native-cylinder-cylinder.qsf's
//   Cylinder(1): start (0, 0, -15), axis +z, radius 5, length 40.
// - sphere (11): the centre and the radius.
// - cone (23): the apex, the unit axis (the way the radius grows), the half
//   angle in radians, how far from the apex the surface starts, its length —
//   cone.qsf, fitted on cone-r5-r10-h20.obj (z -10..10): apex (0, 0, -30),
//   tan(half angle) 0.25, starting 20 from the apex (radius 5).
//
// A cylinder's or cone's length is the one QUICKSURFACE draws, past the
// surface it was fitted on (a 20 mm high scan's cylinder: 42 long, centred).
//
// Anything else in the fixed block or the tail is refused, not guessed at.
const hex = (a: Uint8Array) => Array.from(a, n => n.toString(16).padStart(2, '0')).join('')
const UNSET = '000000e0ffffef47'
type V3 = [number, number, number]

export interface QsfCylinder { kind: 'cylinder'; guid: string; name: string; visible: boolean; fitRms: number; start: V3; axis: V3; radius: number; length: number }
export interface QsfSphere { kind: 'sphere'; guid: string; name: string; visible: boolean; fitRms: number; center: V3; radius: number }
export interface QsfCone { kind: 'cone'; guid: string; name: string; visible: boolean; fitRms: number; apex: V3; axis: V3; halfAngle: number; from: number; length: number }
export type QsfPrimitive = QsfCylinder | QsfSphere | QsfCone

const LAYOUT: Record<number, { kind: QsfPrimitive['kind']; unset: number; numbers: number }> = {
  10: { kind: 'cylinder', unset: 7, numbers: 8 },
  11: { kind: 'sphere', unset: 4, numbers: 4 },
  23: { kind: 'cone', unset: 6, numbers: 9 },
}

export const isQsfPrimitiveType = (type: number): boolean => type in LAYOUT

export function decodeQsfPrimitive(type: number, record: Uint8Array): QsfPrimitive {
  const layout = LAYOUT[type]
  if (!layout) throw new Error('Unsupported QSF primitive type')
  if (record.length < 160 || record.length > 16384) throw new Error('Invalid QSF primitive record size')
  const v = new DataView(record.buffer, record.byteOffset, record.byteLength)
  if (v.getUint32(0, true) !== 0x1a2b3c00 + type) throw new Error('Invalid QSF primitive marker')
  const chars = v.getUint32(120, true), b = 124 + chars * 2
  const fixedLen = 16 + 8 * layout.unset + 8
  const at = b + 16 + fixedLen + 8 + 8
  if (chars > 4096 || at + 8 * layout.numbers + 8 !== record.length) throw new Error('Unsupported QSF primitive layout')
  const guid = hex(record.subarray(12, 28))
  if (hex(record.subarray(b, b + 16)) !== guid) throw new Error('QSF primitive GUID copies disagree')
  const fixed = '00000000000000000000000002000000' + UNSET.repeat(layout.unset) + '0000000000000000'
  if (hex(record.subarray(b + 16, b + 16 + fixedLen)) !== fixed || hex(record.subarray(at - 8, at)) !== 'ffffffff00000000' || record.subarray(record.length - 8).some(x => x !== 0)) throw new Error('Unsupported QSF primitive metadata')
  const fitRms = v.getFloat64(at - 16, true)
  if (!Number.isFinite(fitRms) || fitRms < 0 || fitRms > 1e6) throw new Error('Unsupported QSF primitive fit value')
  const n = Array.from({ length: layout.numbers }, (_, i) => v.getFloat64(at + 8 * i, true))
  if (!n.every(x => Number.isFinite(x) && Math.abs(x) < 1e7)) throw new Error('Unsupported QSF primitive geometry')
  const shown = v.getUint32(32, true)
  if (shown !== 0x10000 && shown !== 0x10001) throw new Error('Unverified object pose/display header variant')
  const head = { guid, name: new TextDecoder('utf-16le', { fatal: true }).decode(record.subarray(124, b)), visible: shown === 0x10001, fitRms }
  if (layout.kind === 'cylinder') {
    const axis: V3 = [n[3], n[4], n[5]]
    if (Math.abs(Math.hypot(...axis) - 1) > 1e-6 || !(n[6] > 0) || !(n[7] >= 0)) throw new Error('Unsupported QSF primitive geometry')
    return { kind: 'cylinder', ...head, start: [n[0], n[1], n[2]], axis, radius: n[6], length: n[7] }
  }
  if (layout.kind === 'cone') {
    const axis: V3 = [n[3], n[4], n[5]]
    if (Math.abs(Math.hypot(...axis) - 1) > 1e-6 || !(n[6] > 0 && n[6] < Math.PI / 2) || !(n[7] >= 0) || !(n[8] > 0)) throw new Error('Unsupported QSF primitive geometry')
    return { kind: 'cone', ...head, apex: [n[0], n[1], n[2]], axis, halfAngle: n[6], from: n[7], length: n[8] }
  }
  if (!(n[3] > 0)) throw new Error('Unsupported QSF primitive geometry')
  return { kind: 'sphere', ...head, center: [n[0], n[1], n[2]], radius: n[3] }
}
