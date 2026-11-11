// SPDX-License-Identifier: AGPL-3.0-only
// Independent reader of the measured QUICKSURFACE 8 project container.
// Directory order is storage order, not a reconstructed feature history.
export interface QsfRecord { type: number; offset: number; bytes: Uint8Array }
export interface QsfContainer { records: QsfRecord[]; source: Uint8Array }
const MAX_BYTES = 512 * 1024 * 1024
const MAX_RECORDS = 100_000

export function readQsfContainer(source: Uint8Array): QsfContainer {
  if (source.byteLength < 148 || source.byteLength > MAX_BYTES) throw Error('QSF file is truncated or exceeds the 512 MiB import limit.')
  const v = new DataView(source.buffer, source.byteOffset, source.byteLength)
  // The fourth word names the QUICKSURFACE build that saved it: 0x80 for
  // 8.0.128, 0x7f for the 8.0.127 projects in the customer hand-off — the
  // same record layout (the directory below is checked twice over).
  const header = [0x37dc4ef7, 1, 4, 0x00800008, 1]
  if (header.some((value, i) => v.getUint32(i * 4, true) !== value && !(i === 3 && v.getUint32(12, true) === 0x007f0008))) throw Error('Unsupported QSF file version. No project data was imported.')
  const count = v.getUint32(144, true)
  const start = 148 + 24 * count
  if (count > MAX_RECORDS || start > source.byteLength) throw Error('Invalid QSF record directory.')
  const entries: { type: number; offset: number }[] = []
  for (let i = 0; i < count; i++) {
    const type = v.getUint32(148 + i * 8, true), offset = v.getUint32(152 + i * 8, true)
    const wide = 148 + count * 8 + i * 16
    if (v.getBigUint64(wide, true) !== BigInt(type) || v.getBigUint64(wide + 8, true) !== BigInt(offset)) throw Error('QSF record directory copies disagree.')
    if (offset < start || offset >= source.byteLength || (i > 0 && offset <= entries[i - 1].offset)) throw Error('QSF record offsets are invalid.')
    entries.push({ type, offset })
  }
  if (count === 0 ? start !== source.byteLength : entries[0].offset !== start) throw Error('Unrecognized QSF data before its first record.')
  return { source, records: entries.map((e, i) => ({ ...e, bytes: source.subarray(e.offset, entries[i + 1]?.offset ?? source.byteLength) })) }
}

export interface QsfMesh { name: string; positions: Float32Array; triangles: Uint32Array; header: Uint8Array }
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
/** Only the observed unchanged mesh state. Other display/pose/selection
 * metadata remains unsupported rather than being interpreted as identity. */
export function validateQsfMeshState(bytes: Uint8Array): { guid: string } {
  if (bytes.length < 156) throw Error('Truncated QSF mesh state.')
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // The word at 32: its low byte shown (1) or hidden (0) — a second scan
  // saved hidden reads 0 — and its top byte a display setting (0x08, or
  // 0x10 in a model shaded another way): neither is geometry, and the scan
  // opens shown in Quick Scan either way.
  const display = v.getUint32(32, true)
  if (v.getUint32(8, true) !== 0 || v.getUint32(28, true) !== 0x006b7376 ||
      (display & 0x00fffffe) !== 0x100 || ![0x08, 0x10].includes(display >>> 24) || bytes.subarray(36, 120).some(b => b !== 0)) throw Error('Unsupported QSF mesh display or pose metadata.')
  const chars = v.getUint32(120, true), end = 124 + chars * 2
  if (chars > 4096 || end + 28 > bytes.length) throw Error('Truncated QSF mesh state.')
  const guid = hex(bytes.subarray(12, 28))
  if (hex(bytes.subarray(end, end + 16)) !== guid || bytes.subarray(end + 16, end + 28).some(b => b !== 0)) throw Error('Unsupported QSF mesh links or transform metadata.')
  return { guid }
}

/** The empty auxiliary lists in the measured one-mesh projects. Extended
 * lists (including selections) are rejected until their semantics are mapped. */
export function validateQsfEmptyAuxiliary(record: QsfRecord, meshGuid: string): void {
  const b = record.bytes
  if (![21, 22].includes(record.type) || b.length !== 116) throw Error('Unsupported QSF auxiliary record.')
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  if (v.getUint32(0, true) !== 0x1a2b3c00 + record.type || v.getUint32(8, true) !== 1 ||
      b.subarray(12, 92).some(x => x !== 0) || hex(b.subarray(92, 108)) !== meshGuid ||
      v.getUint32(108, true) !== 1 || v.getUint32(112, true) !== 0) throw Error('Unsupported QSF auxiliary state or mesh reference.')
}
export function decodeQsfMesh(bytes: Uint8Array): QsfMesh {
  if (bytes.length < 156) throw Error('Truncated QSF mesh.')
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (v.getUint32(0, true) !== 0x1a2b3c04) throw Error('Invalid QSF mesh marker.')
  const chars = v.getUint32(120, true)
  if (chars > 4096 || 156 + 2 * chars > bytes.length) throw Error('Invalid QSF mesh name length.')
  const name = new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(124, 124 + 2 * chars))
  const at = 152 + 2 * chars, vertices = v.getUint32(at, true)
  if (vertices > 10_000_000 || at + 8 + vertices * 12 > bytes.length) throw Error('Invalid QSF mesh vertex count.')
  const faceAt = at + 4 + vertices * 12, faces = v.getUint32(faceAt, true)
  if (faces > 20_000_000 || faceAt + 4 + faces * 12 !== bytes.length) throw Error('Invalid or unsupported QSF mesh face data.')
  const positions = new Float32Array(vertices * 3), triangles = new Uint32Array(faces * 3)
  for (let i = 0; i < positions.length; i++) {
    const value = v.getFloat32(at + 4 + i * 4, true)
    if (!Number.isFinite(value)) throw Error('QSF mesh contains a non-finite coordinate.')
    positions[i] = value
  }
  for (let i = 0; i < triangles.length; i++) {
    const index = v.getUint32(faceAt + 4 + i * 4, true)
    if (index >= vertices) throw Error('QSF mesh contains an invalid vertex reference.')
    triangles[i] = index
  }
  // Keep unclassified metadata: geometry decoding does not establish pose,
  // display state, or original modeling semantics.
  return { name, positions, triangles, header: bytes.slice(0, at) }
}
