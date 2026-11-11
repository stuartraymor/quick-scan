// SPDX-License-Identifier: AGPL-3.0-only
// Real QUICKSURFACE 8 projects open in Quick Scan: saved by QUICKSURFACE
// itself during the parity campaign, kept out of the repository (they hold
// scans), in the fixtures folder (QUICKSCAN_FIXTURES/qsf). Each test reads
// one as Open does and checks what came across against what the project
// was made from or what QUICKSURFACE showed.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fixture } from '../../../tests/fixtures'
import { readQsfProject, inspectQsfProject, qsfLeftOut } from '../app/qsfProject'
import { entityPolyline, type SketchEntity } from '../core/sketch'
import { readQsfContainer } from '../core/qsfContainer'
import { decodeQsfSketch } from '../core/qsfSketch'
import { decodeQsfFitSurface } from '../core/qsfFitSurface'
import type { Vec2 } from '../../../src/core/flat/types'

type El = { kind: string; name: string; visible: boolean; fit: Record<string, unknown> & { center?: number[]; axis?: number[]; radius?: number; length?: number; sigma?: number } }
type Sk = { kind: string; name: string; frame?: { normal: number[] }; sketch?: { entities: { kind: string; a?: number[]; b?: number[] }[]; constraints: { kind: string }[]; referenceChains: [number, number][][] } }

const real = (name: string) => fixture(`qsf/${name}`)
async function open(name: string, answer = true) {
  const f = real(name)
  const asked: string[] = []
  const { manifest, members } = await readQsfProject(new Uint8Array(readFileSync(f.path)), name, (q) => { asked.push(q); return answer })
  return { elements: (manifest.scan?.elements ?? []) as unknown as El[], features: (manifest.reverse as { features: Sk[] }).features, asked, members }
}
const close = (p: readonly number[] | undefined, q: readonly number[], tol: number) => q.forEach((x, i) => expect(Math.abs((p?.[i] ?? NaN) - x)).toBeLessThan(tol))

describe.skipIf(!real('dense-cylinder.qsf').exists)('primitives QUICKSURFACE fitted', () => {
  it('a cylinder as QUICKSURFACE draws it: centred on the 20 mm scan, 42 long, radius 10', async () => {
    const { elements, asked } = await open('dense-cylinder.qsf')
    expect(asked).toEqual([])
    const c = elements.find(e => e.kind === 'cylinder')!
    expect(c.name).toBe('Cylinder(1)')
    close(c.fit.center, [0, 0, 0], 1e-6)
    close(c.fit.axis, [0, 0, 1], 1e-9)
    expect(c.fit.radius).toBeCloseTo(10, 6)
    expect(c.fit.length).toBeCloseTo(42, 6)
  })
  it('a cone from its apex: radius 5 where the scan starts, half angle atan 0.25', async () => {
    const { elements } = await open('cone.qsf')
    const c = elements.find(e => e.kind === 'cone')!
    expect(c.fit.radius1).toBeCloseTo(5, 4)
    expect(c.fit.halfAngle).toBeCloseTo((Math.atan(0.25) * 180) / Math.PI, 3)
    expect(c.fit.length).toBeCloseTo(31, 5)
    close(c.fit.center, [0, 0, -30 + 20 + 15.5], 1e-6)
  })
  it('every primitive in a fit-accuracy project, with the fit RMS QUICKSURFACE gave it', async () => {
    const { elements } = await open('shapes.qsf')
    const of = (k: string) => elements.filter(e => e.kind === k).map(e => e.name)
    expect(of('cylinder')).toEqual(['Cylinder(1)', 'Cylinder(2)', 'Cylinder(3)'])
    expect(of('sphere')).toEqual(['Sphere(1)', 'Sphere(2)'])
    expect(of('cone')).toEqual(['Cone(1)', 'Cone(2)'])
    const s1 = elements.find(e => e.name === 'Sphere(1)')!
    expect(s1.fit.radius).toBeCloseTo(39.992, 3)
    expect(s1.fit.sigma).toBeCloseTo(0.01988, 5)
  })
  it('a tilted cylinder keeps its axis', async () => {
    const { elements } = await open('native-cylinder-cylinder.qsf')
    const c2 = elements.find(e => e.name === 'Cylinder(2)')!
    close(c2.fit.axis, [0.9961947, 0, 0.08715574], 1e-6)
    expect(c2.fit.radius).toBeCloseTo(5, 6)
  })
})

describe.skipIf(!real('sketch-edit-user-start.qsf').exists)('sketches on a tilted plane', () => {
  it('lie on the section of the scan they were fitted to', async () => {
    for (const name of ['sketch-edit-user-start.qsf', 'profile-two-lines.qsf']) {
      const { features, asked } = await open(name)
      expect(asked).toEqual([])
      const sk = features.find(f => f.kind === 'sketch')!
      close(sk.frame!.normal.map(Math.abs), [0, 1, 0], 1e-12)
      const pts = sk.sketch!.referenceChains.flat()
      const upright = sk.sketch!.entities.find(e => e.kind === 'line' && Math.abs(e.a![0] - e.b![0]) < 1e-6)!
      const on = pts.filter(p => Math.abs(p[0] - upright.a![0]) < 0.1 && p[1] >= Math.min(upright.a![1], upright.b![1]) && p[1] <= Math.max(upright.a![1], upright.b![1]))
      expect(on.length).toBeGreaterThan(400)
      expect(sk.sketch!.constraints.map(c => c.kind)).toContain('vertical')
    }
  })
})

describe.skipIf(!real('native-user-start.qsf').exists || !real('native-before-join.igs').exists)('splines QUICKSURFACE fitted in a sketch', () => {
  it('draw the curve QUICKSURFACE exported for the same state, to its precision', async () => {
    const { features, asked } = await open('native-user-start.qsf')
    expect(asked).toEqual([])
    const sp = features.find(f => f.kind === 'sketch')!.sketch!.entities.find(e => e.kind === 'spline') as unknown as SketchEntity & { pts: number[][]; controlKnots: number[] }
    expect(sp.pts).toHaveLength(8)
    expect(sp.controlKnots).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1])
    // The IGES rational B-spline (type 126) QUICKSURFACE wrote: degree,
    // knots, weights (all 1), poles — evaluated by de Boor's algorithm.
    const iges = readFileSync(real('native-before-join.igs').path, 'utf8').split(/\r?\n/).filter(l => l[72] === 'P').map(l => l.slice(0, 64)).join('')
    const n = iges.slice(iges.indexOf('126,')).split(';')[0].split(',').map(Number)
    const K = n[1], M = n[2], knots = n.slice(7, 7 + K + M + 2), poles = n.slice(7 + K + M + 2 + K + 1, 7 + K + M + 2 + K + 1 + 3 * (K + 1))
    sp.pts.forEach((p, i) => close(p, [poles[3 * i], poles[3 * i + 1]], 1e-9))
    const at = (t: number) => {
      let k = M; while (k < K && t >= knots[k + 1]) k++
      const d = Array.from({ length: M + 1 }, (_, j) => [poles[3 * (j + k - M)], poles[3 * (j + k - M) + 1]])
      for (let r = 1; r <= M; r++) for (let j = M; j >= r; j--) { const i = j + k - M, a = (t - knots[i]) / (knots[i + 1 + M - r] - knots[i]); d[j] = [(1 - a) * d[j - 1][0] + a * d[j][0], (1 - a) * d[j - 1][1] + a * d[j][1]] }
      return d[M]
    }
    const ref = Array.from({ length: 20001 }, (_, i) => at(i / 20000))
    const seg = (p: Vec2, a: number[], b: number[]) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)); return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]) }
    let worst = 0
    for (const p of entityPolyline(sp, 200)) { let best = Infinity; for (let i = 1; i < ref.length; i++) best = Math.min(best, seg(p, ref[i - 1], ref[i])); worst = Math.max(worst, best) }
    expect(worst).toBeLessThan(1e-5)
  })
  it('a cut or damaged spline record fails with a reason, never with a crash or a wrong curve', () => {
    const rec = readQsfContainer(new Uint8Array(readFileSync(real('native-user-start.qsf').path))).records.find(r => r.type === 16)!.bytes
    for (let n = 0; n < rec.length; n += 37) expect(() => decodeQsfSketch(rec.subarray(0, n))).toThrow(Error)
    let seed = 7
    for (let k = 0; k < 400; k++) {
      const b = Uint8Array.from(rec)
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      const at = 67086 + (seed % (rec.length - 67086)) // within the spline and the trailer after it
      b[at] ^= 1 + (seed % 255)
      try {
        const s = decodeQsfSketch(b)
        for (const e of s.entities) if (e.poles) expect(e.poles.every(Number.isFinite)).toBe(true)
      } catch (e) { expect(e).toBeInstanceOf(Error) }
    }
  })
  it('keep a spline end and a line end on another line, named as Quick Scan names them', async () => {
    const f = real('block-curve-reference.qsf')
    if (!f.exists) return
    const { features } = await open('block-curve-reference.qsf')
    const c = features.find(x => x.kind === 'sketch')!.sketch!.constraints as unknown as { kind: string; p?: { entity: number; at: string } }[]
    const on = c.filter(x => x.kind === 'pointOn').map(x => x.p)
    expect(on).toEqual([{ entity: 5, at: 'a' }, { entity: 6, at: 'a' }, { entity: 6, at: 'b' }])
  })
})

describe.skipIf(!real('native-preserved.qsf').exists)('a full model with freeform work', () => {
  it('asks first, naming what will not come across; no leaves the session as it was', async () => {
    await expect(open('native-preserved.qsf', false)).rejects.toThrow('The current project was not changed')
    const { asked, members, features } = await open('native-preserved.qsf')
    expect(asked).toHaveLength(1)
    // Its freeform cages and Fit Surface come across; QUICKSURFACE's CAD
    // body, held only as Parasolid, does not.
    expect(asked[0]).toMatch(/1 freeform body/)
    expect(asked[0]).not.toMatch(/freeform curves and patches|freeform surface/)
    expect(asked[0]).toMatch(/original file is kept/)
    expect(members.get('scan.obj')!.byteLength).toBeGreaterThan(1_000_000)
    expect(features.filter(f => f.kind === 'sketch').length).toBeGreaterThan(5)
  })
  it('brings its 20 freeform cages and its Fit Surface across, hidden where QUICKSURFACE hid them', async () => {
    const f = real('native-preserved.qsf')
    const { manifest } = await readQsfProject(new Uint8Array(readFileSync(f.path)), 'native-preserved.qsf', () => true)
    const part = manifest.reverse as { features: { id: number; kind: string; name: string; positions?: number[]; faces?: number[][]; steps?: number; snap?: boolean; controlSurface?: { u: { degree: number; count: number }; v: { count: number } }; region?: number[] }[]; hiddenBodies?: number[] }
    const ff = part.features.filter(x => x.kind === 'freeform')
    expect(ff).toHaveLength(20)
    expect(ff.every(x => x.steps === 3 && x.snap === false)).toBe(true)
    const surface = part.features.find(x => x.kind === 'surface')!
    expect(surface.name).toBe('Fit Surface(1)')
    expect(surface.controlSurface!.u).toMatchObject({ degree: 4, count: 5 })
    expect(surface.region!.length).toBeGreaterThan(10_000)
    // Every freeform hidden, the Fit Surface shown — as saved.
    expect(part.hiddenBodies).toEqual(ff.map(x => x.id))
    // Freeform(2) and (3): the cages QUICKSURFACE exported as quads.
    const obj = real('native-wrap-quads.obj')
    if (obj.exists) {
      const v = readFileSync(obj.path, 'utf8').split(/\r?\n/).filter(l => l.startsWith('v ')).map(l => l.split(/\s+/).slice(1, 4).map(Number))
      for (const name of ['Freeform(2)', 'Freeform(3)']) {
        const c = ff.find(x => x.name === name)!
        for (let i = 0; i < c.positions!.length; i += 3) expect(Math.min(...v.map(p => Math.hypot(p[0] - c.positions![i], p[1] - c.positions![i + 1], p[2] - c.positions![i + 2])))).toBeLessThan(1e-9)
      }
    }
  })
  it('a cut or damaged Fit Surface record fails with a reason, never a crash', () => {
    const rec = readQsfContainer(new Uint8Array(readFileSync(real('native-preserved.qsf').path))).records.find(r => r.type === 25)!.bytes
    for (let n = 0; n < rec.length; n += 9973) expect(() => decodeQsfFitSurface(rec.subarray(0, n))).toThrow(Error)
    let seed = 11
    for (let k = 0; k < 300; k++) {
      const b = Uint8Array.from(rec)
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      const at = k % 2 ? seed % 700 : rec.length - 1 - (seed % 5000) // the header and the BREP's surface
      b[at] ^= 1 + (seed % 255)
      try { const d = decodeQsfFitSurface(b); expect(d.surface.poles.flat().every(Number.isFinite)).toBe(true) } catch (e) { expect(e).toBeInstanceOf(Error) }
    }
  })
  it('a QUICKSURFACE 8.0.127 project opens whole', async () => {
    const f = real('reference-baseline.qsf')
    if (!f.exists) return
    const report = inspectQsfProject(new Uint8Array(readFileSync(f.path)), 'reference-baseline.qsf')
    expect(qsfLeftOut(report)).toEqual([])
    expect(report.supported).toBe(true)
  })
})
