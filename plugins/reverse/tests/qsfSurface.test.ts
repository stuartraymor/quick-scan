// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { decodeQsfSurface } from '../core/qsfSurface'

function fixture(withLink = false) {
  const name = 'Freeform', nameEnd = 124 + name.length * 2
  const settings = nameEnd + 28 + (withLink ? 16 : 0)
  const count = nameEnd + 124 + (withLink ? 16 : 0), vertex = count + 4
  const faceCount = vertex + 4 * 25, face = faceCount + 4, tail = face + 21
  const bytes = new Uint8Array(tail + 4), view = new DataView(bytes.buffer)
  const u32 = (offset: number, value: number) => view.setUint32(offset, value, true)
  u32(0, 0x1a2b3c07); u32(4, 20); u32(28, 0x007b694a); u32(120, name.length)
  const guid = Uint8Array.from({ length: 16 }, (_, i) => i + 1)
  bytes.set(guid, 12); bytes.set(guid, nameEnd)
  for (let i = 0; i < name.length; i++) view.setUint16(124 + i * 2, name.charCodeAt(i), true)
  u32(nameEnd + 24, withLink ? 1 : 0)
  if (withLink) bytes.set(guid.map(x => x + 20), nameEnd + 28)
  u32(settings, 3); u32(settings + 4, 1); u32(count, 4); u32(faceCount, 1)
  const positions = [[-2, 3, 7], [4, 3, 7], [4, 8, 9], [-2, 8, 9]]
  positions.forEach((p, i) => {
    p.forEach((x, j) => view.setFloat32(vertex + i * 25 + j * 4, x, true))
    view.setFloat64(vertex + i * 25 + 12, 1, true)
    u32(face + i * 4, i)
  })
  return { bytes, view, u32, nameEnd, settings, count, vertex, faceCount, face, tail, positions }
}

describe('strict QSF type7 cage decoder', () => {
  it.each([false, true])('decodes measured layout with linked GUID=%s', linked => {
    const f = fixture(linked), out = decodeQsfSurface(f.bytes)
    expect(out.name).toBe('Freeform')
    expect(out.guid).toBe('0102030405060708090a0b0c0d0e0f10')
    expect(out.links).toEqual(linked ? ['15161718191a1b1c1d1e1f2021222324'] : [])
    expect(Array.from(out.vertices)).toEqual(f.positions.flat())
    expect(out.quads).toEqual([[0, 1, 2, 3]])
    expect(out).not.toHaveProperty('transform')
  })

  it('honors byte offsets and owns its decoded data', () => {
    const f = fixture(), backing = new Uint8Array(f.bytes.length + 23)
    backing.set(f.bytes, 11)
    const out = decodeQsfSurface(backing.subarray(11, 11 + f.bytes.length))
    backing.fill(0)
    expect(out.vertices[0]).toBe(-2)
    expect(out.quads[0]).toEqual([0, 1, 2, 3])
  })

  it('rejects every truncated prefix and any trailing data', () => {
    const f = fixture(true)
    for (let n = 0; n < f.bytes.length; n++) expect(() => decodeQsfSurface(f.bytes.subarray(0, n))).toThrow(/Unsupported QSF type7/)
    const extra = new Uint8Array(f.bytes.length + 1); extra.set(f.bytes)
    expect(() => decodeQsfSurface(extra)).toThrow(/trailing data/)
  })

  it.each([
    ['wrong type', (f: ReturnType<typeof fixture>) => f.u32(0, 0x1a2b3c25)],
    ['header flag', f => f.bytes[8] = 1],
    ['common metadata', f => f.bytes[28] = 0],
    ['possible common transform', f => f.bytes[60] = 1],
    ['oversize name', f => f.u32(120, 0xffffffff)],
    ['invalid UTF16', f => f.view.setUint16(124, 0xd800, true)],
    ['GUID mismatch', f => f.bytes[f.nameEnd]++],
    ['object metadata', f => f.bytes[f.nameEnd + 16] = 1],
    ['unknown link count', f => f.u32(f.nameEnd + 24, 2)],
    ['unknown setting', f => f.u32(f.settings, 4)],
    ['possible cage transform', f => f.bytes[f.settings + 8] = 1],
    ['excessive vertices', f => f.u32(f.count, 0xffffffff)],
    ['excessive faces', f => f.u32(f.faceCount, 0xffffffff)],
    ['zero faces', f => f.u32(f.faceCount, 0)],
    ['nonfinite vertex', f => f.view.setFloat32(f.vertex, Infinity, true)],
    ['NaN vertex', f => f.view.setFloat32(f.vertex, NaN, true)],
    ['unknown vertex scalar', f => f.view.setFloat64(f.vertex + 12, 0.5, true)],
    ['unknown vertex flags', f => f.bytes[f.vertex + 20] = 1],
    ['bad index', f => f.u32(f.face, 4)],
    ['degenerate quad', f => f.u32(f.face, 1)],
    ['unknown face flag', f => f.bytes[f.face + 16] = 1],
    ['unknown tail flag', f => f.bytes[f.tail] = 1],
  ] satisfies [string, (f: ReturnType<typeof fixture>) => void][])('refuses %s', (_name, mutate) => {
    const f = fixture(); mutate(f)
    expect(() => decodeQsfSurface(f.bytes)).toThrow(/Unsupported QSF type7 surface/)
  })

  it('rejects oversized records before decoding', () => {
    expect(() => decodeQsfSurface(new Uint8Array(32 * 1024 * 1024 + 1))).toThrow(/32 MiB/)
  })
})
