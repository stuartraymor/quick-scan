// SPDX-License-Identifier: AGPL-3.0-only
// A QUICKSURFACE 8 Fit Surface (record type 25), read from the two saved
// projects that hold one (surface-behavior-2026-11-09/native-preserved.qsf
// and audit-2026-11-08/native-start-audit.qsf, "Fit Surface(1)"):
//
// - the object header — its word at 32 shown (1) or hidden (0); the word at
//   36 is a setting not read (01 09 01 00 in both);
// - the name (its length at 116: this header is 4 bytes shorter than a
//   plane's) and the GUID again, 12 zero bytes;
// - the points it was fitted to: a 64-bit count, then xyz floats — points
//   on the scan's triangles, not its vertices;
// - 40 bytes: the control net's U and V counts, a setting (40), 1, zeros, 1;
// - the fitted face as OCCT BREP text ("CASCADE Topology V3"): one
//   untrimmed face on one non-rational B-spline surface.
//
// The surface is what comes across, exactly: its degrees, knots and poles.
// The net counts before the BREP must be the surface's. Anything else is
// refused, not guessed at.
import type { PolynomialSurface } from './surfaceStep'
import { validate as validateControlSurface } from './surfaceStep'

export interface QsfFitSurface {
  guid: string
  name: string
  visible: boolean
  /** The points it was fitted to, xyz. */
  points: Float32Array
  net: { u: number; v: number }
  surface: PolynomialSurface
}

const MAX_POINTS = 5_000_000
const hex = (a: Uint8Array) => Array.from(a, n => n.toString(16).padStart(2, '0')).join('')
// The four edges of the unit parameter square, as the BREP's 2D curves: the
// face is the whole surface, untrimmed.
const UNTRIMMED = ['1 0 0 0 1', '1 0 0 1 0', '1 1 0 0 1', '1 0 1 1 0']

export function decodeQsfFitSurface(record: Uint8Array): QsfFitSurface {
  const fail = (why: string): never => { throw new Error(`Unsupported QSF fit surface: ${why}`) }
  if (record.length < 240 || record.length > 256 * 1024 * 1024) fail('record size')
  const v = new DataView(record.buffer, record.byteOffset, record.byteLength)
  if (v.getUint32(0, true) !== 0x1a2b3c19 || v.getUint32(8, true) !== 0 || v.getUint32(28, true) !== 0x007b694a) fail('header')
  const shown = v.getUint32(32, true)
  if (shown > 1 || record.subarray(40, 116).some(x => x !== 0)) fail('header')
  // Its object header is 4 bytes shorter than a plane's: the name's length
  // at 116, the name from 120.
  const chars = v.getUint32(116, true), b = 120 + chars * 2
  if (chars === 0 || chars > 1024 || b + 32 > record.length) fail('name')
  const guid = hex(record.subarray(12, 28))
  if (hex(record.subarray(b, b + 16)) !== guid || record.subarray(b + 16, b + 28).some(x => x !== 0)) fail('GUID copy')
  const count = v.getBigUint64(b + 28, true)
  if (count === 0n || count > BigInt(MAX_POINTS)) fail('point count')
  const n = Number(count), at = b + 36, end = at + 12 * n
  if (end + 40 > record.length) fail('truncated')
  const points = new Float32Array(3 * n)
  for (let i = 0; i < 3 * n; i++) {
    const x = v.getFloat32(at + 4 * i, true)
    if (!Number.isFinite(x)) fail('nonfinite point')
    points[i] = x
  }
  const netU = v.getUint32(end, true), netV = v.getUint32(end + 4, true)
  if (v.getUint32(end + 12, true) !== 1 || record.subarray(end + 16, end + 36).some(x => x !== 0) || v.getUint32(end + 36, true) !== 1) fail('settings')
  const text = new TextDecoder('latin1').decode(record.subarray(end + 40))
  if (!text.startsWith('\nCASCADE Topology V3, (c) Open Cascade\n')) fail('BREP header')
  const curves2d = text.match(/\nCurve2ds (\d+)\n([^]*?)\nCurves /)
  if (!curves2d || curves2d[1] !== '4' || curves2d[2].split('\n').map(l => l.trim()).join('|') !== UNTRIMMED.join('|')) fail('trimmed face')
  if ((text.match(/\nFa\n/g) ?? []).length !== 1) fail('face count')
  const s = text.match(/\nSurfaces 1\n([^]*?)\nTriangulations /)
  if (!s) fail('surface count')
  const tok = s![1].trim().split(/\s+/).map(Number)
  if (!tok.every(Number.isFinite)) fail('surface numbers')
  const [kind, ur, vr, up, vp, ud, vd, nu, nv, nuk, nvk] = tok
  if (kind !== 9 || ur || vr || up || vp) fail('surface kind')
  if (![ud, vd, nu, nv, nuk, nvk].every(x => Number.isInteger(x) && x > 0 && x < 1000)) fail('surface size')
  if (tok.length !== 11 + 3 * nu * nv + 2 * (nuk + nvk)) fail('surface layout')
  if (nu !== netU || nv !== netV) fail('net counts disagree with the surface')
  const poles: number[][] = []
  for (let i = 0; i < nu * nv; i++) poles.push(tok.slice(11 + 3 * i, 14 + 3 * i))
  let p = 11 + 3 * nu * nv
  const axis = (degree: number, count: number, knots: number) => {
    const k: number[] = [], m: number[] = []
    for (let i = 0; i < knots; i++) { k.push(tok[p++]); m.push(tok[p++]) }
    return { degree, count, knots: k, mults: m }
  }
  const u = axis(ud, nu, nuk), w = axis(vd, nv, nvk)
  if (u.knots[0] !== 0 || u.knots.at(-1) !== 1 || w.knots[0] !== 0 || w.knots.at(-1) !== 1) fail('parameter range')
  const surface: PolynomialSurface = { u, v: w, poles }
  try { validateControlSurface(surface) } catch { fail('surface definition') }
  return { guid, name: new TextDecoder('utf-16le', { fatal: true }).decode(record.subarray(120, b)), visible: shown === 1, points, net: { u: netU, v: netV }, surface }
}
