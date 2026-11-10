// SPDX-License-Identifier: AGPL-3.0-only
/** Whitelist of the independently checked single-profile positive-normal extrusion.
 * Unknown operation/draft/metadata bytes are rejected rather than interpreted as defaults.
 */
const hex = (a: Uint8Array) => Array.from(a, n => n.toString(16).padStart(2, '0')).join('');
export function decodeQsfExtrude(
  record: Uint8Array,
  metadata: Uint8Array,
  sketch: { guid: string; links: string[] },
  cache?: Uint8Array,
) {
  if (record.length < 200 || record.length > 16384) throw new Error('Invalid QSF extrusion record size');
  const v = new DataView(record.buffer, record.byteOffset, record.byteLength);
  if (v.getUint32(0, true) !== 0x1a2b3c11) throw new Error('Invalid QSF extrusion marker');
  const chars = v.getUint32(120, true);
  if (chars > 4096 || record.length !== 124 + chars * 2 + 76) throw new Error('Unsupported QSF extrusion layout');
  const b = 124 + chars * 2;
  const name = new TextDecoder('utf-16le', { fatal: true }).decode(record.subarray(124, b));
  const guid = hex(record.subarray(12, 28));
  if (hex(record.subarray(b, b + 16)) !== guid) throw new Error('QSF extrusion GUID copies disagree');
  if (v.getUint32(b + 16, true) !== 1 || v.getUint32(b + 20, true) !== 1 || v.getUint32(b + 40, true) !== 0 || record.subarray(b + 52).some(x => x !== 0)) {
    throw new Error('Unsupported QSF extrusion operation or depth/draft flags');
  }
  const sketchGuid = hex(record.subarray(b + 24, b + 40));
  if (sketchGuid !== sketch.guid || sketch.links.length !== 1 || sketch.links[0] !== guid) throw new Error('QSF extrusion/sketch dependency mismatch');
  const depth = v.getFloat64(b + 44, true);
  if (!Number.isFinite(depth) || depth <= 0) throw new Error('Unsupported QSF extrusion depth');
  if (metadata.length !== 220) throw new Error('Unsupported QSF extrusion metadata size');
  const m = new DataView(metadata.buffer, metadata.byteOffset, metadata.byteLength);
  if (m.getUint32(0, true) !== 1 || hex(metadata.subarray(12, 28)) !== guid) throw new Error('QSF extrusion metadata identity mismatch');
  // Measured type62 template. Word4 is native object order, not an operation enum.
  const expected = new Uint8Array(220); const e = new DataView(expected.buffer);
  e.setUint32(0, 1, true); expected.set(metadata.subarray(4, 8), 4); expected.set(metadata.subarray(12, 28), 12);
  for (const p of [68, 92, 148, 196]) { e.setUint32(p, 0xe0000000, true); e.setUint32(p + 4, 0x47efffff, true); }
  if (metadata.some((n, i) => n !== expected[i])) throw new Error('Unsupported QSF extrusion metadata flags');
  if (cache) {
    if (cache.length < 28) throw new Error('Truncated QSF extrusion cache');
    const c = new DataView(cache.buffer, cache.byteOffset, cache.byteLength);
    if (c.getUint32(0, true) !== 0x1a2b3c30 || hex(cache.subarray(12, 28)) !== guid) throw new Error('QSF extrusion cache dependency mismatch');
  }
  return {
    name, guid, sketchGuid, depth, startDepth: 0, endDepth: depth, draftDegrees: 0,
    mode: 'verified-one-sided-positive-normal' as const,
    metadata: Uint8Array.from(metadata),
    cacheAssociated: !!cache,
    limitations: ['Native face splitting and persistent face identifiers are not reconstructed'],
  };
}
