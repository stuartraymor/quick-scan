// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { readQsfContainer, decodeQsfMesh, validateQsfMeshState, validateQsfEmptyAuxiliary } from '../core/qsfContainer'

function mesh() {
  const b = new Uint8Array(200), d = new DataView(b.buffer)
  d.setUint32(0, 0x1a2b3c04, true); d.setUint32(152, 3, true)
  ;[0, 0, 0, 10, 0, 0, 0, 10, 0].forEach((x, i) => d.setFloat32(156 + i * 4, x, true))
  // One triangle needs 208 bytes, including counts and coordinates.
  const out = new Uint8Array(208); out.set(b); const v = new DataView(out.buffer)
  v.setUint32(192, 1, true); [0, 1, 2].forEach((x, i) => v.setUint32(196 + i * 4, x, true)); return out
}
function file(payload = mesh()) {
  const out = new Uint8Array(172 + payload.length), d = new DataView(out.buffer)
  ;[0x37dc4ef7, 1, 4, 0x00800008, 1].forEach((x, i) => d.setUint32(i * 4, x, true))
  d.setUint32(144, 1, true); d.setUint32(148, 4, true); d.setUint32(152, 172, true)
  d.setBigUint64(156, 4n, true); d.setBigUint64(164, 172n, true); out.set(payload, 172); return out
}
describe('QSF bounded container and mesh decoding', () => {
  it('reads a directory and independently specified triangle without alignment assumptions', () => {
    const packed = file(), unaligned = new Uint8Array(packed.length + 1); unaligned.set(packed, 1)
    const result = decodeQsfMesh(readQsfContainer(unaligned.subarray(1)).records[0].bytes)
    expect([...result.positions]).toEqual([0, 0, 0, 10, 0, 0, 0, 10, 0]); expect([...result.triangles]).toEqual([0, 1, 2])
  })
  it.each([0, 3, 100, 147, 171])('refuses truncated headers/directories at %i', n => expect(() => readQsfContainer(file().subarray(0, n))).toThrow())
  it('rejects disagreement, impossible counts, and unsupported versions', () => {
    for (const [at, value] of [[156, 16], [144, 0xffffffff], [12, 0x90009]]) {
      const b = file(); new DataView(b.buffer).setUint32(at, value, true); expect(() => readQsfContainer(b)).toThrow()
    }
  })
  it('refuses unrecognized mesh suffixes, truncation, bad indices and NaN', () => {
    expect(() => decodeQsfMesh(mesh().subarray(0, 207))).toThrow()
    expect(() => decodeQsfMesh(new Uint8Array([...mesh(), 0]))).toThrow()
    const b = mesh(), v = new DataView(b.buffer); v.setUint32(196, 3, true); expect(() => decodeQsfMesh(b)).toThrow('reference')
    v.setUint32(196, 0, true); v.setFloat32(156, NaN, true); expect(() => decodeQsfMesh(b)).toThrow('coordinate')
  })
  it('gates unverified pose/display state and auxiliary lists rather than dropping them', () => {
    const b = mesh(), d = new DataView(b.buffer)
    d.setUint32(28, 0x006b7376, true); d.setUint32(32, 0x08000101, true)
    const { guid } = validateQsfMeshState(b)
    const aux = new Uint8Array(116), v = new DataView(aux.buffer)
    v.setUint32(0, 0x1a2b3c15, true); v.setUint32(8, 1, true); v.setUint32(108, 1, true)
    expect(() => validateQsfEmptyAuxiliary({ type: 21, offset: 0, bytes: aux }, guid)).not.toThrow()
    aux[20] = 1; expect(() => validateQsfEmptyAuxiliary({ type: 21, offset: 0, bytes: aux }, guid)).toThrow('state')
    b[40] = 1; expect(() => validateQsfMeshState(b)).toThrow('metadata')
  })
})
