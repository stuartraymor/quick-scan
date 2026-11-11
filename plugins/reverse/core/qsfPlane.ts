// SPDX-License-Identifier: AGPL-3.0-only
// A QUICKSURFACE 8 datum plane record. Read from 31 plane records across
// the QUICKSURFACE projects saved in this campaign (2026-11-11): the layout
// after the name is fixed at 216 bytes — the GUID again, a fixed block with
// one double in it (the plane's fit RMS: 0 for a plane typed in, small for
// one fitted on the scan), then the normal, the origin, an in-plane
// direction and the shown width and height, then zeros. Anything else in the
// fixed block or the tail is refused rather than guessed at.
const FIXED = '00000000000000000000000002000000000000e0ffffef47000000e0ffffef47000000e0ffffef47000000e0ffffef470000000000000000'
const FIXED_END = 'ffffffff00000000'
const hex = (a: Uint8Array) => Array.from(a, n => n.toString(16).padStart(2, '0')).join('')
type V3 = [number, number, number]

export function decodeQsfPlane(record: Uint8Array) {
  if (record.length < 340 || record.length > 16384) throw new Error('Invalid QSF plane record size')
  const v = new DataView(record.buffer, record.byteOffset, record.byteLength)
  if (v.getUint32(0, true) !== 0x1a2b3c08) throw new Error('Invalid QSF plane marker')
  const chars = v.getUint32(120, true); const b = 124 + chars * 2
  if (chars > 4096 || b + 216 !== record.length) throw new Error('Unsupported QSF plane layout')
  const guid = hex(record.subarray(12, 28))
  if (hex(record.subarray(b, b + 16)) !== guid) throw new Error('QSF plane GUID copies disagree')
  if (hex(record.subarray(b + 16, b + 72)) !== FIXED || hex(record.subarray(b + 80, b + 88)) !== FIXED_END || record.subarray(b + 176).some(x => x !== 0)) throw new Error('Unsupported QSF plane metadata')
  const fitRms = v.getFloat64(b + 72, true)
  if (!Number.isFinite(fitRms) || fitRms < 0 || fitRms > 1e6) throw new Error('Unsupported QSF plane fit value')
  const xyz = (p: number): V3 => [v.getFloat64(b + p, true), v.getFloat64(b + p + 8, true), v.getFloat64(b + p + 16, true)]
  const normal = xyz(88), origin = xyz(112), nativeBasisDirection = xyz(136)
  const nativeDisplaySize = [v.getFloat64(b + 160, true), v.getFloat64(b + 168, true)]
  const finite = [...normal, ...origin, ...nativeBasisDirection, ...nativeDisplaySize].every(Number.isFinite)
  const unit = (a: V3) => Math.abs(Math.hypot(...a) - 1) < 1e-6
  const dot = normal[0] * nativeBasisDirection[0] + normal[1] * nativeBasisDirection[1] + normal[2] * nativeBasisDirection[2]
  if (!finite || !unit(normal) || !unit(nativeBasisDirection) || Math.abs(dot) > 1e-6 || origin.some(x => Math.abs(x) > 1e7) || nativeDisplaySize.some(x => !(x > 0) || x > 1e7)) throw new Error('Unsupported QSF plane geometry variant')
  // The object header's word at 32: its low half is shown (1) or hidden (0),
  // as in a sketch's record (native-visible/native-hidden.qsf, 2026-11-10).
  const shown = v.getUint32(32, true)
  if (shown !== 0x10000 && shown !== 0x10001) throw new Error('Unverified object pose/display header variant')
  return { guid, name: new TextDecoder('utf-16le', { fatal: true }).decode(record.subarray(124, b)), normal, origin,
    nativeBasisDirection, nativeDisplaySize, fitRms, visible: shown === 0x10001, nativeMetadata: Uint8Array.from(record.subarray(b)),
    limitations: ['Native display-size convention is retained as provenance, not converted to a fitted rectangle'] }
}
