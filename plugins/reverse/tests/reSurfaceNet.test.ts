// SPDX-License-Identifier: AGPL-3.0-only
// A Fit Surface's control net (F8 of audit-2026-11-07/FREEFORM_ROADMAP.md),
// the net QUICKSURFACE's Fit Surface draws with Control Net ticked. Measured
// on the native one (basic_part wall, Refined, 5 × 5, degree 4): the net is
// the surface's own B-spline control net — knots 0 0 0 0 0 1 1 1 1 1, the
// four corner poles on the surface's four corners (0.000 mm), the others
// standing off it (mean 30 mm, up to 76 mm on that curved wall). Here the
// pole lies at the Greville abscissa of the fit's frame, its height the
// fit's; the surface is exactly the B-spline of these poles, which is what
// is held below, with the corners on the surface.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { moveSurfacePole, type PolynomialSurface } from '../core/surfaceStep'
import type { SurfaceFeature } from '../core/features'
import type { Vec3 } from '../../../src/core/types'
import type { SceneManager } from '../../../src/viewer/SceneManager'
import { refused, run, soupOf, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import { basisFunctions, controlNetOf, DEFAULT_SURFACE_FIT, evalSurface, findSpan, fitSurface } from '../core/surfaceFit'
import { useReverse } from '../state/reStore'
import plugin from '../plugin'
import { gridScan } from './networkMeshes'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 300_000 })

/** A point of the B-spline of the net's poles in space, by de Boor's basis — a path of its own, not the fit's height evaluation. */
function poleSurface(fit: ReturnType<typeof fitSurface>, net: ReturnType<typeof controlNetOf>, u: number, v: number): Vec3 {
  const p = fit.degree
  const su = findSpan(fit.knotsU, fit.nu, p, u)
  const sv = findSpan(fit.knotsV, fit.nv, p, v)
  const bu = new Float64Array(p + 1)
  const bv = new Float64Array(p + 1)
  basisFunctions(fit.knotsU, su, p, u, bu)
  basisFunctions(fit.knotsV, sv, p, v, bv)
  const out: Vec3 = [0, 0, 0]
  for (let a = 0; a <= p; a++) {
    for (let b = 0; b <= p; b++) {
      const o = ((su - p + a) * net.cols + (sv - p + b)) * 3
      for (let k = 0; k < 3; k++) out[k] += bu[a] * bv[b] * net.points[o + k]
    }
  }
  return out
}

describe('a Fit Surface’s control net', () => {
  const surface = (x: number, y: number) => 12 * Math.sin(x / 40) + 0.1 * y
  const pts: number[] = []
  for (let x = -60; x <= 60; x += 2) for (let y = -40; y <= 40; y += 2) pts.push(x, y, surface(x, y))
  const fit = fitSurface(new Float64Array(pts), { ...DEFAULT_SURFACE_FIT, net: { u: 5, v: 5 }, degree: 4 })
  const net = controlNetOf(fit)

  it('has the net’s poles, rows along u and columns along v, finite', () => {
    expect(net).toMatchObject({ rows: 5, cols: 5, degree: 4 })
    expect(net.points).toHaveLength(5 * 5 * 3)
    expect(net.points.every(Number.isFinite)).toBe(true)
  })

  it('is the surface’s own B-spline: it reproduces the fitted surface everywhere', () => {
    let worst = 0
    for (let i = 0; i <= 20; i++) {
      for (let j = 0; j <= 20; j++) {
        const u = fit.uRange[0] + ((fit.uRange[1] - fit.uRange[0]) * i) / 20
        const v = fit.vRange[0] + ((fit.vRange[1] - fit.vRange[0]) * j) / 20
        const a = evalSurface(fit, u, v)
        const b = poleSurface(fit, net, u, v)
        worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]))
      }
    }
    expect(worst).toBeLessThan(1e-9)
  })

  it('has its four corner poles on the surface’s corners, as native’s clamped net has', () => {
    const corner = (r: number, c: number): Vec3 => {
      const o = (r * net.cols + c) * 3
      return [net.points[o], net.points[o + 1], net.points[o + 2]]
    }
    const at = (u: number, v: number) => evalSurface(fit, u, v)
    const [u0, u1] = fit.uRange
    const [v0, v1] = fit.vRange
    for (const [r, c, u, v] of [[0, 0, u0, v0], [0, 4, u0, v1], [4, 0, u1, v0], [4, 4, u1, v1]] as const) {
      const a = corner(r, c)
      const b = at(u, v)
      expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(1e-9)
    }
  })

  it('has the poles of a Bezier net standing off a curved surface, as native’s do', () => {
    // On a curved surface an inner pole is not on it: the net is a control net, not the surface sampled.
    let farthest = 0
    for (let r = 1; r < 4; r++) {
      for (let c = 1; c < 4; c++) {
        const o = (r * net.cols + c) * 3
        const p: Vec3 = [net.points[o], net.points[o + 1], net.points[o + 2]]
        let nearest = Infinity
        for (let i = 0; i <= 60; i++) for (let j = 0; j <= 60; j++) {
          const s = evalSurface(fit, fit.uRange[0] + ((fit.uRange[1] - fit.uRange[0]) * i) / 60, fit.vRange[0] + ((fit.vRange[1] - fit.vRange[0]) * j) / 60)
          nearest = Math.min(nearest, Math.hypot(p[0] - s[0], p[1] - s[1], p[2] - s[2]))
        }
        farthest = Math.max(farthest, nearest)
      }
    }
    expect(farthest).toBeGreaterThan(0.5)
  })
})

const sheet = (u: number, v: number): Vec3 => [100 * u, 80 * v, 6 * Math.sin(2 * u) * Math.cos(v)]
const mesh = gridScan(120, 96, sheet, { noise: 0.01 })
const scene = { scanPositions: () => mesh.positions, scanIndices: () => Uint32Array.from(mesh.indices) } as unknown as SceneManager

describe('reverse.surface.net', () => {
  let headless: Headless
  let session: ReverseSession
  const stops: (() => void)[] = []
  beforeAll(async () => {
    plugin.install?.()
    headless = await startHeadless()
    session = createReverseSession({ sceneRef: { current: scene }, kernel: () => new ReClient(localKernel()) })
    stops.push(installReverseSession(session), session.watch())
    await run('scan.open', { bytes: stlBytes(soupOf(mesh)), name: 'sheet.stl', discard: true })
  }, 120_000)
  afterAll(() => {
    for (const stop of stops) stop()
    headless.stop()
  })
  beforeEach(resetReverse)

  interface Net {
    surface: { id: number; name: string }
    rows: number
    cols: number
    degree: number
    poles: number[][][]
    exact?: PolynomialSurface
  }

  it('reads the net of a fitted surface: its size, its degree and its poles', async () => {
    await run('reverse.feature.add', { feature: { kind: 'surface', name: 'Skin', region: { box: { min: [5, 5, -20], max: [95, 75, 20] } }, fit: { net: { u: 5, v: 5 }, degree: 4 } } })
    const r = await run<Net>('reverse.surface.net', { surface: 'Skin' })
    expect(r.surface.name).toBe('Skin')
    expect(r).toMatchObject({ rows: 5, cols: 5, degree: 4 })
    expect(r.poles).toHaveLength(5)
    for (const row of r.poles) {
      expect(row).toHaveLength(5)
      for (const p of row) expect(p).toHaveLength(3)
    }
    // The same net by id, and the poles span about the region, a little past it (the margin).
    const again = await run<Net>('reverse.surface.net', { surface: r.surface.id })
    expect(again.poles).toEqual(r.poles)
    const xs = r.poles.flat().map((p) => p[0])
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(85)
    expect(useReverse.getState().features.filter((f) => f.kind === 'surface')).toHaveLength(1)
    // The command's reported net must also be the actual exported CAD net,
    // rather than a differently parameterized interpolation of its samples.
    const exported = await run<{ file: { bytes: Uint8Array }; verify: { ok: boolean } }>('reverse.export.step', { verify: true })
    expect(exported.verify.ok).toBe(true)
    const text = new TextDecoder().decode(exported.file.bytes)
    const spline = text.match(/B_SPLINE_SURFACE_WITH_KNOTS\s*\(\s*'[^']*'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*\(([\s\S]*?)\)\s*,\s*\.UNSPECIFIED\./)
    expect(spline).not.toBeNull()
    expect(Number(spline![1])).toBe(r.degree)
    expect(Number(spline![2])).toBe(r.degree)
    expect(spline![3].match(/#\d+/g)?.length).toBe(r.rows * r.cols)
  })

  it('keeps edited poles through MCP rename, exposes exact geometry and clears it on explicit refit', async () => {
    await run('reverse.feature.add', { feature: { kind: 'surface', name: 'Editable', region: { box: { min: [5,5,-20], max: [95,75,20] } }, fit: { net: { u:5,v:5 }, degree:4 } } })
    const initial=await run<Net>('reverse.surface.net',{surface:'Editable'})
    expect(initial.exact).toBeDefined()
    const edited=moveSurfacePole(initial.exact!,1,2,[1.23456789,-.987654321,.456789123])
    const state=useReverse.getState();state.editFeature(initial.surface.id)
    useReverse.getState().setFeatureDraft({controlSurface:edited})
    useReverse.getState().commitFeature()
    await session.settled()
    await run('reverse.feature.update',{feature:initial.surface.id,set:{name:'Renamed'}})
    const renamed=await run<Net>('reverse.surface.net',{surface:'Renamed'})
    expect(renamed.exact).toEqual(edited)
    expect((useReverse.getState().features[0] as SurfaceFeature).controlSurface).toEqual(edited)
    await run('reverse.feature.update',{feature:initial.surface.id,set:{fit:{net:{u:5,v:5},degree:4}}})
    expect((useReverse.getState().features[0] as SurfaceFeature).controlSurface).toBeUndefined()
    const refitted=await run<Net>('reverse.surface.net',{surface:'Renamed'})
    expect(refitted.exact).not.toEqual(edited)
    expect(refitted.exact).toEqual(initial.exact)
  })

  it('moves one pole through MCP, refuses invalid indices and supports undo/redo', async()=>{
    await run('reverse.feature.add',{feature:{kind:'surface',name:'Moveable',region:{box:{min:[5,5,-20],max:[95,75,20]}},fit:{net:{u:5,v:5},degree:4}}})
    const initial=await run<Net>('reverse.surface.net',{surface:'Moveable'})
    const expected=moveSurfacePole(initial.exact!,2,1,[2,-1,.5],50)
    await run('reverse.surface.move_pole',{surface:'Moveable',u:2,v:1,by:[2,-1,.5],strength:50})
    expect((await run<Net>('reverse.surface.net',{surface:'Moveable'})).exact).toEqual(expected)
    expect((await refused('reverse.surface.move_pole',{surface:'Moveable',u:5,v:1,by:[1,0,0]})).message).toMatch(/outside/)
    expect((await run<Net>('reverse.surface.net',{surface:'Moveable'})).exact).toEqual(expected)
    await run('history.undo');await session.settled()
    expect((await run<Net>('reverse.surface.net',{surface:'Moveable'})).exact).toEqual(initial.exact)
    await run('history.redo');await session.settled()
    expect((await run<Net>('reverse.surface.net',{surface:'Moveable'})).exact).toEqual(expected)
  })

  it('refuses what has no net', async () => {
    await run('reverse.feature.add', { feature: { kind: 'surface', name: 'Flat', shape: 'plane', region: { box: { min: [5, 5, -20], max: [95, 75, 20] } } } })
    expect((await refused('reverse.surface.net', { surface: 'Flat' })).message).toMatch(/no control net/)
    expect((await refused('reverse.surface.net', { surface: 'Nothing' })).message).toBeTruthy()
  })
})
