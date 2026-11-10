// SPDX-License-Identifier: AGPL-3.0-only
/** Strict, independently measured QSF sketch-record decoder.
 * Geometry is not application-ready until frame.supported and editableSupported are true.
 * Never treats opaque native metadata as a solved constraint or an identity transform.
 */
const LINE = '5f34e60d18fe5848986ace6f2c0fa157';
const CIRCLE = 'cba13e9e64a49e4897836e8b5de2b247';
const ARC = 'bb93de9441f27d438a1d534626450648';
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const MAX_COUNT = 1_000_000;
class Reader {
  p = 0;
  v: DataView;
  constructor(readonly bytes: Uint8Array) { this.v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  need(n: number) { if (!Number.isSafeInteger(n) || n < 0 || this.p + n > this.bytes.length) throw new Error('Truncated QSF sketch record'); }
  raw(n: number) { this.need(n); const a = Uint8Array.from(this.bytes.subarray(this.p, this.p + n)); this.p += n; return a; }
  u32() { this.need(4); const n = this.v.getUint32(this.p, true); this.p += 4; return n; }
  count() { const n = this.u32(); if (n > MAX_COUNT) throw new Error('QSF sketch count exceeds limit'); return n; }
  f64() { this.need(8); const n = this.v.getFloat64(this.p, true); this.p += 8; if (!Number.isFinite(n)) throw new Error('Nonfinite QSF sketch coordinate'); return n; }
  f32() { this.need(4); const n = this.v.getFloat32(this.p, true); this.p += 4; if (!Number.isFinite(n)) throw new Error('Nonfinite QSF reference coordinate'); return n; }
  doubles(n: number) { this.need(n * 8); return Array.from({ length: n }, () => this.f64()); }
  zero(n: number, label: string) { if (this.raw(n).some(x => x !== 0)) throw new Error(`Unsupported QSF ${label}`); }
  expect(n: number, label: string) { if (this.u32() !== n) throw new Error(`Unsupported QSF ${label}`); }
}
const hex = (a: Uint8Array) => Array.from(a, n => n.toString(16).padStart(2, '0')).join('');
const verifiedRotation = (a: number[]) => [IDENTITY, [0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0]].some(expected => a.every((n, i) => [3, 7, 11].includes(i) || Math.abs(n - expected[i]) <= 1e-12));
export type QsfSketchEntity = {
  kind: 'line' | 'circle' | 'arc'; classGuid: string; transform: number[];
  points: number[]; center?: number[]; radius?: number; nativeFlags: number[];
};
export type QsfSketchConstraint = {
  nativeType: number; value: number; entityIndices: [number, number]; pointIndices: [number, number];
  raw: Uint8Array; auxiliary: Uint8Array;
  semantic: 'coincident' | 'horizontal' | 'vertical' | 'distance' | 'angle' | 'radius';
};
const SEMANTICS: Record<number, QsfSketchConstraint['semantic']> = {
  2: 'coincident', 5: 'horizontal', 6: 'vertical', 9: 'distance', 11: 'angle', 12: 'radius',
};
export function decodeQsfSketch(record: Uint8Array) {
  if (record.length > 128 * 1024 * 1024) throw new Error('QSF sketch record exceeds size limit');
  const r = new Reader(record);
  r.expect(0x1a2b3c10, 'sketch marker');
  const nativeHeaderWord = r.u32();
  // This word varies with native object ordering; it is retained, not treated as a format version.
  r.p = 12; const guid = hex(r.raw(16));
  r.p = 32; const visibility = r.u32(); if (visibility !== 0 && visibility !== 1) throw new Error('Unsupported QSF sketch visibility');
  r.p = 120; const chars = r.count();
  if (chars > 4096) throw new Error('QSF sketch name exceeds limit');
  const name = new TextDecoder('utf-16le', { fatal: true }).decode(r.raw(chars * 2));
  if (hex(r.raw(16)) !== guid) throw new Error('QSF sketch GUID copies disagree');
  r.zero(8, 'sketch header flags');
  const linkCount = r.count(); r.need(linkCount * 16);
  const links = Array.from({ length: linkCount }, () => hex(r.raw(16)));
  r.zero(4, 'reference header flags'); r.expect(1, 'reference version'); r.expect(11, 'reference type');
  if (hex(r.raw(16)) !== '72fab92cb9c8e54d88de526080553831') throw new Error('Unsupported QSF reference class');
  const referenceCount = r.count();
  const references: { transform: number[]; points: number[] }[] = [];
  r.need(referenceCount * 100);
  for (let i = 0; i < referenceCount; i++) {
    const count = r.count(); const transform = r.doubles(12); r.need(count * 12);
    const points = Array.from({ length: count * 3 }, () => r.f32()); references.push({ transform, points });
  }
  const transform = r.doubles(12); r.zero(76, 'sketch frame flags'); r.expect(1, 'entity list version');
  const count = r.count(); r.need(count * 196);
  const entities: QsfSketchEntity[] = [];
  for (let i = 0; i < count; i++) {
    const classGuid = hex(r.raw(16));
    if (![LINE, CIRCLE, ARC].includes(classGuid)) throw new Error(`Unsupported QSF entity class ${classGuid}`);
    r.zero(4, 'entity flags'); const matrix = r.doubles(12); const points = r.doubles(9);
    const nativeFlags = [r.u32(), r.u32()];
    if (nativeFlags[0] !== 0 || nativeFlags[1] !== 1) throw new Error('Unsupported QSF entity state flags');
    const entity: QsfSketchEntity = { kind: classGuid === LINE ? 'line' : classGuid === CIRCLE ? 'circle' : 'arc', classGuid, transform: matrix, points, nativeFlags };
    if (classGuid !== LINE) {
      entity.center = r.doubles(3); entity.radius = r.f64();
      if (entity.radius <= 0 || r.raw(1)[0] !== (classGuid === CIRCLE ? 1 : 0)) throw new Error('Unsupported QSF circular entity');
    }
    entities.push(entity);
  }
  r.expect(count, 'entity flag count'); r.zero(count, 'entity flags');
  const constraintCount = r.count(); r.need(constraintCount * 184);
  const constraints: QsfSketchConstraint[] = [];
  for (let i = 0; i < constraintCount; i++) {
    const raw = r.raw(184); const v = new DataView(raw.buffer); const nativeType = v.getUint32(16, true);
    const semantic = SEMANTICS[nativeType];
    if (!semantic) throw new Error(`Unsupported QSF constraint type ${nativeType}`);
    const value = v.getFloat64(20, true);
    if (!Number.isFinite(value)) throw new Error('Nonfinite QSF constraint value');
    const entityIndices: [number, number] = [v.getUint32(168, true), v.getUint32(172, true)];
    const pointIndices: [number, number] = [v.getInt32(52, true), v.getInt32(56, true)];
    if (entityIndices.some(n => n >= count)) throw new Error('Invalid QSF constraint entity index');
    if (nativeType === 12) {
      if (entities[entityIndices[0]].kind !== 'circle' || pointIndices[0] !== 4 || pointIndices[1] !== -1) throw new Error('Unsupported QSF radius selectors');
    } else if (pointIndices.some(n => n < 0 || n > 1)) throw new Error('Unsupported QSF point selector');
    constraints.push({ nativeType, value, entityIndices, pointIndices, semantic, raw, auxiliary: new Uint8Array() });
  }
  r.zero(4, 'cache flags');
  const cachedPoints = entities.map(() => { const n = r.count(); return r.doubles(n * 3); });
  r.zero(count, 'cached entity flags'); r.expect(referenceCount, 'reference flag count'); r.zero(referenceCount, 'reference flags');
  r.zero(count, 'secondary entity flags'); r.expect(1, 'constraint metadata version'); r.expect(constraintCount, 'constraint metadata count');
  for (const c of constraints) c.auxiliary = r.raw(156);
  r.expect(1, 'final entity version'); r.expect(count, 'final entity count'); r.zero(count, 'final entity flags');
  if (r.p !== record.length) throw new Error('Unmapped trailing QSF sketch bytes');
  const frameSupported = verifiedRotation(transform) && references.every(x => verifiedRotation(x.transform)) && entities.every(x => x.transform.every((n, i) => [3, 7, 11].includes(i) || Math.abs(n - IDENTITY[i]) <= 1e-12));
  const limitations: string[] = [];
  if (!frameSupported) limitations.push('Rotated frame convention is not verified');
  if (entities.some(e => e.kind === 'arc')) limitations.push('Arc orientation is not independently verified');
  if (constraints.some(c => c.nativeType === 11 || c.nativeType === 12)) limitations.push('Angle/diameter display metadata is not verified');
  // Constraint records retain native flag/display metadata; decoding does not assert solver equivalence.
  if (constraints.length) limitations.push('Native constraint flags and auxiliary metadata are retained but not semantically verified');
  return { name, guid, visible: visibility === 1, links, nativeHeaderWord, references, frame: { transform, supported: frameSupported, origin: [transform[3], transform[7], transform[11]] as [number, number, number], normal: [transform[2], transform[6], transform[10]] as [number, number, number], basisU: [transform[0], transform[4], transform[8]] as [number, number, number], basisV: [transform[1], transform[5], transform[9]] as [number, number, number], entityCoordinates: 'local' as const, referenceCoordinates: 'world' as const }, entities, constraints, cachedPoints, editableSupported: limitations.length === 0, limitations, consumedBytes: r.p };
}





/** Exact measured driving-diameter metadata subset. No general native flag enum is inferred.
 * Changed label/display/reference metadata deliberately fails this gate.
 */
export function isVerifiedQsfDrivingDiameter(c: QsfSketchConstraint): boolean {
  if (c.nativeType !== 12 || !Number.isFinite(c.value) || c.value <= 0 || c.entityIndices[0] !== c.entityIndices[1] || c.pointIndices[0] !== 4 || c.pointIndices[1] !== -1) return false;
  const expectedRaw = RAW_DIAMETER;
  if (c.raw.length !== 184 || c.auxiliary.length !== 156) return false;
  for (let i = 0; i < 184; i++) {
    // Radius changes under driving edit; these two serialized native pointer slots change across saves.
    if ((i >= 20 && i < 28) || (i >= 36 && i < 52)) continue;
    if (c.raw[i] !== parseInt(expectedRaw.slice(i * 2, i * 2 + 2), 16)) return false;
  }
  return hex(c.auxiliary) === AUX_DIAMETER;
}
const RAW_DIAMETER = '0000000048fb17410100000000cbebeb0c000000000000000000244000c0ebebfe7f000030a693050000000030a693050000000004000000ffffffff0000010000000000000000000000000078c946415ce919410000000078c946415ce9194100000000ffff7f7f0000000000000000000000000000000048f40440000000003c7ae83fffff7f7f000000000000000000000000000000000000000000000000000000000000000000000000000000006c00790000000000';
const AUX_DIAMETER = '0000000000000000000000000000000054597e31000000e0ffffef4700000000000000000000000000000000000000e0ffffef470000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';



/** Preserved-project coincidence binding, independently verified by native endpoint drag.
 * This intentionally does not claim arbitrary native geometric-constraint modes.
 */
export function isVerifiedQsfCoincidentEndpoints(c: QsfSketchConstraint, entities: QsfSketchEntity[]): boolean {
  if (c.nativeType !== 2 || c.value !== 0 || c.entityIndices[0] !== 0 || c.entityIndices[1] !== 1 || c.pointIndices[0] !== 0 || c.pointIndices[1] !== 0 || entities.length !== 2 || entities.some(e => e.kind !== 'line')) return false;
  if (Math.hypot(...entities[0].points.slice(0, 3).map((n, i) => n - entities[1].points[i])) > 1e-9) return false;
  if (c.raw.length !== 184 || c.auxiliary.length !== 156 || hex(c.auxiliary) !== AUX_COINCIDENT) return false;
  return RAW_COINCIDENT.some(expected => {
    for (let i = 0; i < 184; i++) {
      // These pointer/padding bytes changed on visibility-only native save.
      // Annotation position changed on native coupled endpoint drag with unchanged binding.
      if ((i >= 28 && i < 52) || (i >= 88 && i < 100)) continue;
      if (c.raw[i] !== parseInt(expected.slice(i * 2, i * 2 + 2), 16)) return false;
    }
    return true;
  });
}
const RAW_COINCIDENT = ["0000000048fb174101000000004b7bf70200000000000000000000000000440000000000b0767804000000005063780400000000000000000000000000000100000000000000000000000000000000000000000000000000703ecb4136121f4100000000ffff7f7f00000000000000000000000000000000404bca3f00000000404bca3fffff7f7f000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000", "0000000048fb174101000000004b7bf70200000000000000000000000033a00400000000306778040000000020697804000000000000000000000000000001f7f97f00000000000000000000000000000000000000000000703ecb4136121f4100000000ffff7f7f00000000000000000000000000000000404bca3f00000000404bca3fffff7f7f000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000"];
const AUX_COINCIDENT = "0000000000000000000000000000000000000000000000e0ffffef4700000000000000000000000000000000000000e0ffffef470000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
