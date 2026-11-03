// SPDX-License-Identifier: AGPL-3.0-only
// Edit Sketch → Export in IGES, as QUICKSURFACE offers it: the sketch's
// geometry placed in 3D on its plane. Lines are IGES lines (110); arcs and
// circles are circular arcs (100) drawn in the sketch's own plane and placed
// by one transformation matrix (124); splines go out as short lines.
// Construction geometry and points are left out.

import type { SectionFrame } from '../../../src/core/section/frame'
import type { Vec2 } from '../../../src/core/flat/types'
import { entityPolyline, type SketchEntity } from './sketch'

/** A number as IGES writes it: plain decimal, no exponent surprises. */
const num = (v: number): string => {
  if (!Number.isFinite(v)) return '0.0'
  const t = Number(v.toFixed(9)).toString()
  return t.includes('.') || t.includes('e') ? t : `${t}.0`
}
/** An IGES Hollerith string. */
const holl = (s: string): string => `${s.length}H${s}`

interface Entity { type: number; form: number; params: string[]; transform: number }

export function sketchToIges(entities: readonly SketchEntity[], frame: SectionFrame, name = 'sketch'): string {
  const { origin: o, basisU: u, basisV: v, normal: n } = frame
  const at = (p: Vec2): [number, number, number] => [o[0] + u[0] * p[0] + v[0] * p[1], o[1] + u[1] * p[0] + v[1] * p[1], o[2] + u[2] * p[0] + v[2] * p[1]]
  const out: Entity[] = []
  // Entity 1: the plane's placement, for the arcs. Its directory entry is 1.
  out.push({ type: 124, form: 0, transform: 0, params: [u[0], v[0], n[0], o[0], u[1], v[1], n[1], o[1], u[2], v[2], n[2], o[2]].map(num) })
  const placement = 1
  const line = (a: Vec2, b: Vec2) => { const [p, q] = [at(a), at(b)]; out.push({ type: 110, form: 0, transform: 0, params: [...p, ...q].map(num) }) }
  for (const e of entities) {
    if (e.construction || e.kind === 'point') continue
    if (e.kind === 'line') line(e.a, e.b)
    else if (e.kind === 'arc' || e.kind === 'circle') {
      // IGES arcs run counter-clockwise from start to end.
      const a0 = e.kind === 'arc' ? (e.sweep >= 0 ? e.start : e.start + e.sweep) : 0
      const a1 = e.kind === 'arc' ? a0 + Math.abs(e.sweep) : 0
      const s: Vec2 = [e.c[0] + e.r * Math.cos(a0), e.c[1] + e.r * Math.sin(a0)]
      const f: Vec2 = [e.c[0] + e.r * Math.cos(a1), e.c[1] + e.r * Math.sin(a1)]
      out.push({ type: 100, form: 0, transform: placement, params: [0, e.c[0], e.c[1], s[0], s[1], f[0], f[1]].map(num) })
    } else {
      const poly = entityPolyline(e)
      for (let i = 0; i + 1 < poly.length; i++) line(poly[i], poly[i + 1])
    }
  }

  const pad = (s: string, w: number) => s.padEnd(w).slice(0, w)
  const right = (s: string | number, w = 8) => String(s).padStart(w).slice(-w)
  const section = (text: string, letter: string, start: number, width = 72) => {
    const lines: string[] = []
    for (let i = 0; i < text.length; i += width) lines.push(pad(text.slice(i, i + width), 72) + letter + right(start + lines.length, 7))
    return lines
  }
  const date = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '.')
  const startLines = section(`Quick Scan sketch export: ${name}`, 'S', 1)
  const global = [',', ';', holl(name), holl(`${name}.igs`), holl('Quick Scan'), holl('Quick Scan'), '32', '38', '6', '308', '15', holl(name), '1.0', '2', holl('MM'), '1', '0.01', holl(date), '0.001', '10000.0', holl('Quick Scan'), holl(''), '11', '0', holl(date)]
    .map((g, i) => (i < 2 ? holl(g) : g)).join(',') + ';'
  const globalLines = section(global, 'G', 1)

  // Parameter lines: data in columns 1-64, the entity's DE pointer in 66-72.
  const dir: string[] = []
  const par: string[] = []
  out.forEach((e, k) => {
    const de = k * 2 + 1
    const data = `${e.type},${e.params.join(',')};`
    const first = par.length + 1
    const chunks: string[] = []
    for (let i = 0; i < data.length; i += 64) chunks.push(data.slice(i, i + 64))
    for (const c of chunks) par.push(pad(c, 64) + ' ' + right(de, 7) + 'P' + right(par.length + 1, 7))
    const deTransform = e.transform ? e.transform * 2 - 1 : 0
    dir.push(right(e.type) + right(first) + right(0) + right(0) + right(0) + right(0) + right(deTransform) + right(0) + '00000000' + 'D' + right(de, 7))
    dir.push(right(e.type) + right(0) + right(0) + right(chunks.length) + right(e.form) + right('') + right('') + right('') + right(0) + 'D' + right(de + 1, 7))
  })
  const term = pad(`S${right(startLines.length, 7)}G${right(globalLines.length, 7)}D${right(dir.length, 7)}P${right(par.length, 7)}`, 72) + 'T' + right(1, 7)
  return [...startLines, ...globalLines, ...dir, ...par, term].join('\r\n') + '\r\n'
}
