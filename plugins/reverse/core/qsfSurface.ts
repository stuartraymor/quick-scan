// SPDX-License-Identifier: AGPL-3.0-only
// Measured type7 subdivision-cage records, not fitted B-spline surfaces or
// reconstructed feature history. Evidence: analysis/qsf-import-next-2026-11-10/surfaces.

export interface DecodedQsfSurface {
  name: string
  /** Stored byte order, lowercase hex; no assumed Windows UUID conversion. */
  guid: string
  /** Uninterpreted identity links, not claimed to be regeneration dependencies. */
  links: string[]
  /** XYZ in stored coordinates. No transform interpretation has been verified. */
  vertices: Float64Array
  quads: [number, number, number, number][]
  visible: boolean
}

const MAX_BYTES = 32 * 1024 * 1024
const MAX_VERTICES = 250_000
const MAX_QUADS = 250_000

/** Decode only the observed zero-flag, default-metadata cage variant.
 * Unknown metadata is rejected rather than silently changing geometry/settings.
 * The caller must retain the original record and disclose unresolved history,
 * crease, snap and refinement semantics before constructing an editable feature. */
export function decodeQsfSurface(record: Uint8Array): DecodedQsfSurface {
  const fail = (message: string): never => { throw new Error(`Unsupported QSF type7 surface: ${message}.`) }
  if (record.byteLength > MAX_BYTES) fail('record exceeds the 32 MiB limit')
  const view = new DataView(record.buffer, record.byteOffset, record.byteLength)
  const bound = (offset: number, size: number) => {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset > record.byteLength - size) fail('truncated record')
  }
  const u32 = (offset: number) => { bound(offset, 4); return view.getUint32(offset, true) }
  const zero = (offset: number, size: number, field: string) => {
    bound(offset, size)
    for (let i = offset; i < offset + size; i++) if (record[i] !== 0) fail(`unmapped nonzero ${field} at byte ${i}`)
  }
  const guidAt = (offset: number) => {
    bound(offset, 16)
    const bytes = record.subarray(offset, offset + 16)
    if (!bytes.some(x => x !== 0)) fail('empty GUID')
    return Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('')
  }
  if (u32(0) !== 0x1a2b3c07) fail('record marker is not type7')
  // Bytes4..7 are the object integer ID, not a format version.
  zero(8, 4, 'header flags')
  const guid = guidAt(12)
  if (u32(28) !== 0x007b694a) fail('unmapped common metadata variant')
  // The word at 32 is shown (1) or hidden (0), as a plane's or a sketch's
  // (native-start-audit.qsf has these cages shown, native-preserved.qsf hidden).
  const shown = u32(32)
  if (shown > 1) fail('unmapped visibility word')
  zero(36, 84, 'common metadata or transform')
  const chars = u32(120)
  if (chars === 0 || chars > 1024) fail('invalid name length')
  bound(124, chars * 2)
  let name: string
  try { name = new TextDecoder('utf-16le', { fatal: true }).decode(record.subarray(124, 124 + chars * 2)) }
  catch { return fail('invalid UTF-16 name') }
  if (!name || /[\u0000-\u001f\u007f]/.test(name)) fail('invalid name characters')
  const nameEnd = 124 + chars * 2
  if (guidAt(nameEnd) !== guid) fail('repeated GUID mismatch')
  zero(nameEnd + 16, 8, 'object metadata')
  const linkCount = u32(nameEnd + 24)
  if (linkCount > 1) fail('unverified linked GUID count')
  const links = Array.from({ length: linkCount }, (_, i) => guidAt(nameEnd + 28 + i * 16))
  const settings = nameEnd + 28 + linkCount * 16
  if (u32(settings) !== 3 || u32(settings + 4) !== 1) fail('unmapped cage settings variant')
  zero(settings + 8, 88, 'cage settings or transform')
  const vertexCountOffset = nameEnd + 124 + linkCount * 16
  const vertexCount = u32(vertexCountOffset)
  if (vertexCount < 4 || vertexCount > MAX_VERTICES) fail('invalid or excessive vertex count')
  const vertexStart = vertexCountOffset + 4
  bound(vertexStart, vertexCount * 25)
  const faceCountOffset = vertexStart + vertexCount * 25
  const faceCount = u32(faceCountOffset)
  if (faceCount === 0 || faceCount > MAX_QUADS) fail('invalid or excessive quad count')
  const faceStart = faceCountOffset + 4
  bound(faceStart, faceCount * 21 + vertexCount)
  if (faceStart + faceCount * 21 + vertexCount !== record.byteLength) fail('unmapped trailing data')
  const vertices = new Float64Array(vertexCount * 3)
  for (let i = 0; i < vertexCount; i++) {
    const offset = vertexStart + i * 25
    for (let j = 0; j < 3; j++) {
      const value = view.getFloat32(offset + j * 4, true)
      if (!Number.isFinite(value)) fail('nonfinite vertex coordinate')
      vertices[i * 3 + j] = value
    }
    // Observed constant only: deliberately not interpreted as a rational weight.
    if (view.getFloat64(offset + 12, true) !== 1) fail('unmapped vertex scalar')
    zero(offset + 20, 5, 'vertex flags')
  }
  const quads: DecodedQsfSurface['quads'] = []
  for (let i = 0; i < faceCount; i++) {
    const offset = faceStart + i * 21
    const quad: [number, number, number, number] = [u32(offset), u32(offset + 4), u32(offset + 8), u32(offset + 12)]
    if (quad.some(index => index >= vertexCount)) fail('quad index outside vertex array')
    if (new Set(quad).size !== 4) fail('degenerate quad indices')
    zero(offset + 16, 5, 'quad flags')
    quads.push(quad)
  }
  zero(faceStart + faceCount * 21, vertexCount, 'per-vertex tail flags')
  return { name, guid, links, vertices, quads, visible: shown === 1 }
}
