// SPDX-License-Identifier: AGPL-3.0-only
/** Exact metadata guard for the independently observed cylinder datum plane. */
export function decodeQsfPlane(record: Uint8Array) {
  if (record.length < 340 || record.length > 16384) throw new Error('Invalid QSF plane record size');
  const v = new DataView(record.buffer, record.byteOffset, record.byteLength);
  if (v.getUint32(0, true) !== 0x1a2b3c08) throw new Error('Invalid QSF plane marker');
  const chars = v.getUint32(120, true); const b = 124 + chars * 2;
  if (chars > 4096 || b + 216 !== record.length) throw new Error('Unsupported QSF plane layout');
  const hex = (a: Uint8Array) => Array.from(a, n => n.toString(16).padStart(2, '0')).join('');
  const guid = hex(record.subarray(12, 28));
  if (hex(record.subarray(b, b + 16)) !== guid) throw new Error('QSF plane GUID copies disagree');
  const prefix = '00000000000000000000000002000000000000e0ffffef47000000e0ffffef47000000e0ffffef47000000e0ffffef4700000000000000000000000000000000ffffffff00000000';
  if (hex(record.subarray(b + 16, b + 88)) !== prefix || record.subarray(b + 176).some(x => x !== 0)) throw new Error('Unsupported QSF plane metadata');
  const xyz = (p: number): [number, number, number] => [v.getFloat64(b + p, true), v.getFloat64(b + p + 8, true), v.getFloat64(b + p + 16, true)];
  const normal = xyz(88), origin = xyz(112), nativeBasisDirection = xyz(136);
  const nativeDisplaySize = [v.getFloat64(b + 160, true), v.getFloat64(b + 168, true)];
  // Native datum Z5 and corresponding zero-offset/offset sketches are independently observed.
  // Extending this whitelist needs new native plane fixtures, not a guessed enum interpretation.
  if (normal.some((n, i) => n !== [0, 0, 1][i]) || origin.some((n, i) => n !== [0, 0, 5][i]) || nativeBasisDirection.some((n, i) => n !== [0, -1, 0][i]) || nativeDisplaySize.some(n => n !== 15.5)) throw new Error('Unsupported QSF plane geometry variant');
  return { guid, name: new TextDecoder('utf-16le', { fatal: true }).decode(record.subarray(124, b)), normal, origin,
    nativeBasisDirection, nativeDisplaySize, fitRms: 0, nativeMetadata: Uint8Array.from(record.subarray(b)),
    limitations: ['Native display-size convention is retained as provenance, not converted to a fitted rectangle'] };
}
