// SPDX-License-Identifier: AGPL-3.0-only
/** Strict, independently measured QSF sketch-record decoder.
 * Geometry is not application-ready until frame.supported and editableSupported are true.
 * Never treats opaque native metadata as a solved constraint or an identity transform.
 */
const LINE = '5f34e60d18fe5848986ace6f2c0fa157';
const CIRCLE = 'cba13e9e64a49e4897836e8b5de2b247';
const ARC = 'bb93de9441f27d438a1d534626450648';
const SPLINE = '5e1bae82b5f86549aa3e493bc09685eb';
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
  kind: 'line' | 'circle' | 'arc' | 'spline'; classGuid: string; transform: number[];
  /** A spline's: the points it was fitted through and its control points, xyz in the sketch frame; cubic, uniformly clamped. */
  fitPoints?: number[]; poles?: number[]; degree?: 3;
  /** The distinct knots of the clamped cubic, read from the record's trailer. */
  knots?: number[];
  points: number[]; center?: number[]; radius?: number; nativeFlags: number[];
};
export type QsfSketchConstraint = {
  nativeType: number; value: number; entityIndices: [number, number]; pointIndices: [number, number];
  raw: Uint8Array; auxiliary: Uint8Array;
  /** 'other': a native type not mapped yet — carried so it can be named, never applied. */
  semantic: 'coincident' | 'horizontal' | 'vertical' | 'distance' | 'angle' | 'radius' | 'pointOn' | 'other';
};
const SEMANTICS: Record<number, QsfSketchConstraint['semantic']> = {
  2: 'coincident', 5: 'horizontal', 6: 'vertical', 9: 'distance', 11: 'angle', 12: 'radius',
  // A piece's point on another piece (block-curve-reference.qsf: a line's
  // start and a spline's first and last pole on the upright line).
  21: 'pointOn',
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
  const count = r.count(); r.need(count * 196); // the smallest piece, a line
  const entities: QsfSketchEntity[] = [];
  for (let i = 0; i < count; i++) {
    const classGuid = hex(r.raw(16));
    if (![LINE, CIRCLE, ARC, SPLINE].includes(classGuid)) throw new Error(`Unsupported QSF entity class ${classGuid}`);
    r.zero(4, 'entity flags'); const matrix = r.doubles(12); const points = r.doubles(9);
    const nativeFlags = [r.u32(), r.u32()];
    if (nativeFlags[0] !== 0 || nativeFlags[1] !== 1) throw new Error('Unsupported QSF entity state flags');
    if (classGuid === SPLINE) {
      // A fitted curve: the points it was fitted through, then 10 bytes —
      // a zero, a byte that changes from save to save, the degree (3) and
      // a word not read — the same points twice more, 24 bytes each, 12
      // zero bytes, and its control points, 24 bytes each. The knots are
      // not stored: QUICKSURFACE's IGES export of the same state
      // (0.0.136 native-before-join.igs) has these 8 control points to
      // float precision, uniformly clamped (0, 0.2 … 1).
      const fitCount = r.count(); r.need(fitCount * 12);
      const fitPoints = Array.from({ length: fitCount * 3 }, () => r.f32());
      const head = r.raw(10), hv = new DataView(head.buffer);
      if (head[0] !== 0 || hv.getUint32(2, true) !== 3) throw new Error('Unsupported QSF spline degree');
      for (let copy = 0; copy < 2; copy++) {
        if (r.count() !== fitCount) throw new Error('Unsupported QSF spline point copies');
        r.need(fitCount * 24);
        for (let i = 0; i < fitCount; i++) {
          for (let k = 0; k < 3; k++) if (r.f32() !== fitPoints[3 * i + k]) throw new Error('Unsupported QSF spline point copies');
          r.zero(12, 'spline point padding');
        }
      }
      r.zero(12, 'spline flags');
      const poleCount = r.count(); r.need(poleCount * 24);
      const poles: number[] = [];
      for (let i = 0; i < poleCount; i++) { poles.push(r.f32(), r.f32(), r.f32()); r.zero(12, 'spline pole padding'); }
      if (poleCount < 4) throw new Error('Unsupported QSF spline pole count');
      entities.push({ kind: 'spline', classGuid, transform: matrix, points, nativeFlags, fitPoints, poles, degree: 3 });
      continue;
    }
    const entity: QsfSketchEntity = { kind: classGuid === LINE ? 'line' : classGuid === CIRCLE ? 'circle' : 'arc', classGuid, transform: matrix, points, nativeFlags };
    if (classGuid !== LINE) {
      entity.center = r.doubles(3); entity.radius = r.f64();
      if (entity.radius <= 0 || r.raw(1)[0] !== (classGuid === CIRCLE ? 1 : 0)) throw new Error('Unsupported QSF circular entity');
    }
    entities.push(entity);
  }
  // One byte a piece, 0 or 1 — 1 on some lines, with or without splines in
  // the sketch (pass3-quicksurface.qsf, block-curve-reference.qsf); what it
  // sets is not known, so it is carried, not applied.
  r.expect(count, 'entity flag count');
  const pieceFlags = Array.from(r.raw(count));
  if (pieceFlags.some(x => x > 1)) throw new Error('Unsupported QSF entity flags');
  const constraintCount = r.count(); r.need(constraintCount * 184);
  const constraints: QsfSketchConstraint[] = [];
  for (let i = 0; i < constraintCount; i++) {
    const raw = r.raw(184); const v = new DataView(raw.buffer); const nativeType = v.getUint32(16, true);
    const semantic = SEMANTICS[nativeType] ?? 'other';
    const value = v.getFloat64(20, true);
    if (!Number.isFinite(value)) throw new Error('Nonfinite QSF constraint value');
    const entityIndices: [number, number] = [v.getUint32(168, true), v.getUint32(172, true)];
    const pointIndices: [number, number] = [v.getInt32(52, true), v.getInt32(56, true)];
    if (entityIndices.some(n => n >= count)) throw new Error('Invalid QSF constraint entity index');
    if (nativeType === 12) {
      if (entities[entityIndices[0]].kind !== 'circle' || pointIndices[0] !== 4 || pointIndices[1] !== -1) throw new Error('Unsupported QSF radius selectors');
    } else if (semantic !== 'other') {
      // A point selector names a line's or arc's end (0, 1) or a spline's
      // control point by its index; "point on" selects nothing on its target.
      const points = (e: QsfSketchEntity) => e.kind === 'spline' ? (e.poles?.length ?? 0) / 3 : 2;
      const valid = (n: number, i: number) => n >= 0 && n < points(entities[entityIndices[i]]);
      if (semantic === 'pointOn' ? !valid(pointIndices[0], 0) || pointIndices[1] !== -1 : !valid(pointIndices[0], 0) || !valid(pointIndices[1], 1)) throw new Error('Unsupported QSF point selector');
    }
    constraints.push({ nativeType, value, entityIndices, pointIndices, semantic, raw, auxiliary: new Uint8Array() });
  }
  r.zero(4, 'cache flags');
  const cachedPoints = entities.map(() => { const n = r.count(); return r.doubles(n * 3); });
  r.zero(count, 'cached entity flags'); r.expect(referenceCount, 'reference flag count'); r.zero(referenceCount, 'reference flags');
  // One byte a piece; a spline's is 1, followed by its B-spline in full:
  // a zero, the degree, the distinct knots, their multiplicities and the
  // control points in double precision (0.0.136 native-user-start.qsf: 3,
  // 0 0.2 0.4 0.6 0.8 1, 4 1 1 1 1 4, the 8 poles of native-before-join.igs).
  // The record ends with the same list again, each definition led by two
  // zero bytes instead of one and followed by its poles' weights and its fit
  // points; it must say the same.
  const readDefinitions = (zeros: number) => {
    const out = new Map<number, { knots: number[]; poles: number[] }>();
    entities.forEach((e, index) => {
      const flag = r.raw(1)[0];
      if (flag === 0 && e.kind !== 'spline') return;
      if (flag !== 1 || e.kind !== 'spline') throw new Error('Unsupported QSF secondary entity flags');
      if (r.raw(zeros).some(x => x !== 0) || r.u32() !== 3) throw new Error('Unsupported QSF spline definition');
      const knotCount = r.count(); r.need(knotCount * 8); const knots = r.doubles(knotCount);
      if (r.count() !== knotCount) throw new Error('Unsupported QSF spline definition');
      r.need(knotCount * 4); const multiplicities = Array.from({ length: knotCount }, () => r.u32());
      const poleCount = r.count(); r.need(poleCount * 24); const poles = r.doubles(poleCount * 3);
      // The second copy also weighs each pole: 1 each, a plain (not rational) curve.
      if (zeros === 2 && (r.count() !== poleCount || r.doubles(poleCount).some(w => w !== 1))) throw new Error('Unsupported QSF rational spline');
      // ... and then the points it was fitted through, in double precision.
      if (zeros === 2) {
        const fit = e.fitPoints ?? [];
        if (r.count() * 3 !== fit.length) throw new Error('Unsupported QSF spline definition');
        r.need(fit.length * 8);
        if (r.doubles(fit.length).some((x, i) => Math.abs(x - fit[i]) > 1e-4 * Math.max(1, Math.abs(x)))) throw new Error('Unsupported QSF spline definition');
      }
      const clamped = multiplicities.every((m, i) => m === (i === 0 || i === knotCount - 1 ? 4 : 1));
      const rising = knots.every((k, i) => i === 0 || k > knots[i - 1]);
      if (!clamped || !rising || poleCount !== knotCount + 2 || poleCount !== (e.poles?.length ?? 0) / 3) throw new Error('Unsupported QSF spline definition');
      // The double poles are the curve; the float copy beside the piece must agree with them.
      if (poles.some((x, i) => Math.abs(x - (e.poles?.[i] ?? NaN)) > 1e-4 * Math.max(1, Math.abs(x)))) throw new Error('Unsupported QSF spline definition');
      out.set(index, { knots, poles });
    });
    return out;
  };
  const definitions = readDefinitions(1);
  r.expect(1, 'constraint metadata version'); r.expect(constraintCount, 'constraint metadata count');
  for (const c of constraints) c.auxiliary = r.raw(156);
  r.expect(1, 'final entity version'); r.expect(count, 'final entity count');
  const again = readDefinitions(2);
  for (const [index, d] of definitions) {
    const e = again.get(index);
    if (!e || e.knots.join() !== d.knots.join() || e.poles.join() !== d.poles.join()) throw new Error('Unsupported QSF final entity flags');
    Object.assign(entities[index], d);
  }
  if (again.size !== definitions.size) throw new Error('Unsupported QSF final entity flags');
  if (r.p !== record.length) throw new Error('Unmapped trailing QSF sketch bytes');
  const frameSupported = verifiedRotation(transform) && references.every(x => verifiedRotation(x.transform)) && entities.every(x => x.transform.every((n, i) => [3, 7, 11].includes(i) || Math.abs(n - IDENTITY[i]) <= 1e-12));
  const limitations: string[] = [];
  if (!frameSupported) limitations.push('Rotated frame convention is not verified');
  if (entities.some(e => e.kind === 'arc')) limitations.push('Arc orientation is not independently verified');
  if (constraints.some(c => c.nativeType === 11 || c.nativeType === 12)) limitations.push('Angle/diameter display metadata is not verified');
  // Constraint records retain native flag/display metadata; decoding does not assert solver equivalence.
  if (constraints.length) limitations.push('Native constraint flags and auxiliary metadata are retained but not semantically verified');
  if (pieceFlags.some(x => x === 1)) limitations.push('A per-piece native setting is not read');
  return { name, guid, visible: visibility === 1, links, nativeHeaderWord, references, frame: { transform, supported: frameSupported, origin: [transform[3], transform[7], transform[11]] as [number, number, number], normal: [transform[2], transform[6], transform[10]] as [number, number, number], basisU: [transform[0], transform[4], transform[8]] as [number, number, number], basisV: [transform[1], transform[5], transform[9]] as [number, number, number], entityCoordinates: 'local' as const, referenceCoordinates: 'world' as const }, entities, constraints, cachedPoints, pieceFlags, editableSupported: limitations.length === 0, limitations, consumedBytes: r.p };
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
