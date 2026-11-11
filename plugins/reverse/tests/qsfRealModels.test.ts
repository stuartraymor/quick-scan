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

describe.skipIf(!real('native-preserved.qsf').exists)('a full model with freeform work', () => {
  it('asks first, naming what will not come across; no leaves the session as it was', async () => {
    await expect(open('native-preserved.qsf', false)).rejects.toThrow('The current project was not changed')
    const { asked, members, features } = await open('native-preserved.qsf')
    expect(asked).toHaveLength(1)
    expect(asked[0]).toMatch(/freeform curves and patches/)
    expect(asked[0]).toMatch(/original file is kept/)
    expect(members.get('scan.obj')!.byteLength).toBeGreaterThan(1_000_000)
    expect(features.filter(f => f.kind === 'sketch').length).toBeGreaterThan(5)
  })
  it('a QUICKSURFACE 8.0.127 project opens whole', async () => {
    const f = real('reference-baseline.qsf')
    if (!f.exists) return
    const report = inspectQsfProject(new Uint8Array(readFileSync(f.path)), 'reference-baseline.qsf')
    expect(qsfLeftOut(report)).toEqual([])
    expect(report.supported).toBe(true)
  })
})
