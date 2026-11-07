// SPDX-License-Identifier: AGPL-3.0-only
// A cage as a quad OBJ — the file QUICKSURFACE writes as "Freeform surfaces
// as quads (*.obj)" and reads back with From quad OBJ: `v x y z` lines and
// `f` lines of 1-based (or negative, counted back) indices, a `/`-suffixed
// texture or normal index ignored; polygons kept whole, never fanned, as
// the scan reader (src/core/parsers/obj.ts) fans them. Groups, objects,
// normals and materials are passed over. Creases are not in the OBJ: a
// `# crease a b` comment line (1-based) is read and written here so a cage
// of our own keeps them.

import type { Cage } from './cage'

export function parseQuadObj(text: string): Cage {
  const positions: number[] = []
  const faces: number[][] = []
  const creases: [number, number][] = []
  const lines = text.split(/\r?\n/)
  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li]
    if (raw.startsWith('# crease ')) {
      const [a, b] = raw.slice(9).trim().split(/\s+/).map(Number)
      if (Number.isInteger(a) && Number.isInteger(b)) creases.push([a - 1, b - 1])
      continue
    }
    const hash = raw.indexOf('#')
    const line = (hash < 0 ? raw : raw.slice(0, hash)).trim()
    if (line.length < 3) continue
    if (line.startsWith('v ') || line.startsWith('v\t')) {
      const parts = line.split(/\s+/)
      const x = Number(parts[1]), y = Number(parts[2]), z = Number(parts[3])
      if (parts.length < 4 || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new Error(`Invalid OBJ vertex on line ${li + 1}.`)
      positions.push(x, y, z)
    } else if (line.startsWith('f ') || line.startsWith('f\t')) {
      const parts = line.split(/\s+/)
      const count = positions.length / 3
      const face: number[] = []
      for (let i = 1; i < parts.length; i++) {
        const token = parts[i].split('/')[0]
        const idx = Number(token)
        if (!/^-?\d+$/.test(token) || idx === 0 || idx > count || idx < -count) throw new Error(`Invalid OBJ face index on line ${li + 1}.`)
        face.push(idx < 0 ? count + idx : idx - 1)
      }
      if (face.length < 3) throw new Error(`A face of ${face.length} vertices on line ${li + 1}.`)
      faces.push(face)
    }
  }
  if (positions.length === 0) throw new Error('The OBJ has no vertices.')
  if (faces.length === 0) throw new Error('The OBJ has no faces.')
  for (const [a, b] of creases) if (!(a >= 0 && b >= 0 && a < positions.length / 3 && b < positions.length / 3)) throw new Error('A crease names a vertex the OBJ has not.')
  return { positions: Float64Array.from(positions), faces, creases }
}

/** The cage as a quad OBJ, every number at full precision, so a cage read
 *  and written comes back equal. */
export function writeQuadObj(c: Cage, comment = 'Quick Scan freeform cage'): string {
  const out: string[] = [`# ${comment}`, '']
  const p = c.positions
  for (let i = 0; i < p.length; i += 3) out.push(`v ${p[i]} ${p[i + 1]} ${p[i + 2]}`)
  out.push(`# ${p.length / 3} vertices`, '')
  for (const f of c.faces) out.push('f ' + f.map((v) => `${v + 1}`).join(' '))
  out.push(`# ${c.faces.length} faces`)
  for (const [a, b] of c.creases) out.push(`# crease ${a + 1} ${b + 1}`)
  return out.join('\n') + '\n'
}
