// SPDX-License-Identifier: AGPL-3.0-only
// Hundreds of 2D Sketch workflows driven by the mouse and keys, seeded so a
// failure can be replayed. The scan is plate-dense, the plate QUICKSURFACE
// 8.0.128 was measured on (see e2e-sketch-autofillet-native): a 40 x 30
// plate with an R5 round bottom right (native Auto Fillet R 5.004061), a
// 3 x 9 elliptical corner top right (native R 4.565252) and two sharp corners.
//
// Corner workflows: two lines drawn by mouse along the plate's sides, short
// of a corner or past it, or one polyline round it; then Corner Trim, Auto
// Fillet or Fixed Size Fillet swept over the corner as a hand would sweep it.
// Each result is checked against the rules measured natively: the corner
// point decides whether a fillet is made, a fillet is always an arc, a
// fillet between separate lines is two undo steps. Undo must give back the
// lines exactly and Redo the corner exactly.
//
// Drawing workflows: a random run of the ribbon's drawing tools, each
// checked for what it adds, then the whole run undone and redone.
//
// The DEV hook is used to start the sketch, to map sketch millimetres to
// pixels and to read the result; every edit goes through the rendered
// controls.
// Usage: node e2e-sketch-gui-workflows.mjs [cornerCount=160] [drawCount=80] [seed=1]
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { launchApp, loadScan, sleep, shotPath } from '../../../scripts/e2e-lib.mjs'
import { openReverse } from './lib.mjs'

const CORNERS = Number(process.argv[2] ?? 160), DRAWS = Number(process.argv[3] ?? 80), SEED = Number(process.argv[4] ?? 1)
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',').map(Number)) : null
const out = shotPath('sketch-gui-workflows'); fs.mkdirSync(out, { recursive: true })
let seed = SEED >>> 0 || 1
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296 }
const pick = (list) => list[Math.floor(rnd() * list.length)]
const between = (a, b) => a + (b - a) * rnd()

// plate-dense, as in e2e-sketch-autofillet-native.
const R = 5, W = 20, H = 15, o = []
const seg = (a, b) => { const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5)); for (let i = 0; i < n; i++) o.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]) }
seg([-W, -H], [W - R, -H])
for (let i = 0; i < 24; i++) { const a = -Math.PI / 2 + (Math.PI / 2) * i / 24; o.push([W - R + R * Math.cos(a), -H + R + R * Math.sin(a)]) }
seg([W, -H + R], [W, H - 9])
for (let i = 0; i < 32; i++) { const a = (Math.PI / 2) * i / 32; o.push([W - 3 + 3 * Math.cos(a), H - 9 + 9 * Math.sin(a)]) }
seg([W - 3, H], [-W, H]); seg([-W, H], [-W, -H])
const n = o.length, m = []
for (const z of [-5, 5]) for (const [x, y] of o) m.push(`v ${x} ${y} ${z}`)
m.push('v 0 0 -5', 'v 0 0 5')
for (let i = 0; i < n; i++) { const a = i + 1, b = (i + 1) % n + 1; m.push(`f ${a} ${b} ${b + n}`, `f ${a} ${b + n} ${a + n}`, `f ${2 * n + 1} ${b} ${a}`, `f ${2 * n + 2} ${a + n} ${b + n}`) }
const meshPath = out + '/plate-dense.obj'; fs.writeFileSync(meshPath, m.join('\n'))

// Each corner: its point, the directions along its two sides away from it,
// how far each side runs, the round's reach on each side, and what Auto
// Fillet must make there (QUICKSURFACE's radius, or null for a sharp join).
const CORNER = {
  BR: { p: [W, -H], d1: [-1, 0], d2: [0, 1], run: [38, 28], round: [5, 5], auto: 5.004061 },
  TR: { p: [W, H], d1: [0, -1], d2: [-1, 0], run: [28, 38], round: [9, 3], auto: 4.565252 },
  TL: { p: [-W, H], d1: [1, 0], d2: [0, -1], run: [38, 28], round: [0, 0], auto: null },
  BL: { p: [-W, -H], d1: [0, 1], d2: [1, 0], run: [28, 38], round: [0, 0], auto: null },
}
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k]
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
const endsOf = (e) => e.kind === 'line' ? [e.a, e.b] : e.kind === 'arc' ? [[e.c[0] + e.r * Math.cos(e.start), e.c[1] + e.r * Math.sin(e.start)], [e.c[0] + e.r * Math.cos(e.start + e.sweep), e.c[1] + e.r * Math.sin(e.start + e.sweep)]] : []
const crossing = (l1, l2) => {
  const d1 = [l1.b[0] - l1.a[0], l1.b[1] - l1.a[1]], d2 = [l2.b[0] - l2.a[0], l2.b[1] - l2.a[1]]
  const den = d1[0] * d2[1] - d1[1] * d2[0]; if (Math.abs(den) < 1e-12) return null
  const t = ((l2.a[0] - l1.a[0]) * d2[1] - (l2.a[1] - l1.a[1]) * d2[0]) / den
  return add(l1.a, d1, t)
}
const diff = (a, b) => { const out = []; const walk = (x, y, p) => { if (JSON.stringify(x) === JSON.stringify(y)) return; if (x && y && typeof x === 'object' && typeof y === 'object' && out.length < 6) { for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], p + '.' + k) } else out.push(`${p}: ${JSON.stringify(x)?.slice(0, 120)} -> ${JSON.stringify(y)?.slice(0, 120)}`) }; walk(a, b, ''); return out.slice(0, 6).join(' ; ') }
const finite = (v) => JSON.stringify(v, (k, x) => (typeof x === 'number' && !Number.isFinite(x) ? (() => { throw new Error(`non-finite ${k}`) })() : x))

const { browser, page, consoleErrors } = await launchApp({ width: 1800, height: 1100, protocolTimeout: 600_000 })
const pageErrors = []; page.on('pageerror', (e) => pageErrors.push(String(e)))
const sketch = () => page.evaluate(() => window.__re.store.getState().sketchDraft.sketch)
const history = () => page.evaluate(() => window.__re.store.getState().sketchDraft.history.length)
const draftTool = () => page.evaluate(() => window.__re.store.getState().sketchDraft.tool)
const screen = (p) => page.evaluate((p) => window.__re.sheet().sheetScreenPoint(p), p)
const message = () => page.$eval('[data-test=corner-message]', (e) => e.textContent).catch(() => null)
const clickAt = async (p) => { const s = await screen(p); await page.mouse.click(s.x, s.y); await sleep(110) }
const escape = async (times = 1) => { for (let i = 0; i < times; i++) { await page.keyboard.press('Escape'); await sleep(120) } }
// Every element handle is let go: a handle kept into a closed sketch editor
// keeps that whole detached editor alive, which looked like a leak in the app.
const exists = async (sel) => { const h = await page.$(sel); if (h) await h.dispose(); return !!h }
const button = async (sel) => { await page.$eval(sel, (e) => e.click()); await sleep(160) }
const sweep = async (path) => {
  const pts = []; for (const p of path) pts.push(await screen(p))
  await page.mouse.move(pts[0].x, pts[0].y); await page.mouse.down()
  for (const p of pts.slice(1)) await page.mouse.move(p.x, p.y, { steps: 8 })
  await sleep(150); await page.mouse.up(); await sleep(450)
}
const undo = async (k, how) => { for (let i = 0; i < k; i++) { if (how === 'key') { await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control') } else await page.click('[data-test=undo]'); await sleep(220) } }
const redo = async (k, how) => { for (let i = 0; i < k; i++) { if (how === 'key') { await page.keyboard.down('Control'); await page.keyboard.press('y'); await page.keyboard.up('Control') } else await page.click('[data-test=redo]'); await sleep(220) } }
const fresh = async () => {
  await page.evaluate(() => { const r = window.__re.store; r.setState({ sketchDraft: null }); r.getState().startSketch({ kind: 'world', axis: 'z', offset: 0 }, { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }, []) })
  await (await page.waitForSelector('[data-test=sketch-sharpen]')).dispose(); await sleep(700)
  await page.evaluate(() => window.__re.sheet().zoomTo?.([-26, -20, 26, 20])); await sleep(250)
}

const results = [], failures = []
const record = (row, problem) => {
  results.push({ ...row, ok: !problem, problem: problem ?? undefined })
  if (problem) { failures.push({ ...row, problem }); console.log('FAIL', JSON.stringify({ ...row, problem })) }
  // Preserve completed scenarios if a later one hangs, and distinguish the
  // actual UI actions from merely different random seeds.
  fs.writeFileSync(out + `/progress-seed${SEED}.json`, JSON.stringify({ seed: SEED, total: results.length, failed: failures.length, results }, null, 1))
  if (results.length % 10 === 0) console.log(`PROGRESS seed ${SEED}: ${results.length} completed, ${failures.length} failed`)
}

try {
  await loadScan(page, meshPath); await openReverse(page)
  if (await page.$('[data-test=support-card] .sc-x')) await page.$eval('[data-test=support-card] .sc-x', (e) => e.click())
  await fresh()

  // ---- Corner workflows ----
  for (let w = 0; w < CORNERS; w++) {
    const name = pick(Object.keys(CORNER)), C = CORNER[name]
    const kind = rnd() < 0.2 ? 'polyline' : 'lines'
    const mode = pick(['trim', 'autoFillet', 'autoFillet', 'fixedFillet'])
    const gesture = rnd() < 0.15 ? 'stroke' : pick(['box', 'loop', 'box-off'])
    // How far short of the corner each line stops (negative: past it).
    const gap = [0, 1].map((i) => (rnd() < 0.15 ? -between(0.5, 3) : between(C.round[i] ? 0.3 : 0.6, 12)))
    const len = [0, 1].map((i) => Math.min(between(6, 16), C.run[i] - Math.max(gap[i], 0) - 2))
    const radius = Math.round(between(0.5, Math.min(6, 0.8 * Math.min(len[0] + Math.max(gap[0], 0), len[1] + Math.max(gap[1], 0)))) * 10) / 10
    const how = rnd() < 0.5 ? 'key' : 'button'
    const row = { w, seed: SEED, corner: name, kind, mode, gesture, gap: gap.map((g) => +g.toFixed(2)), len: len.map((l) => +l.toFixed(2)), radius: mode === 'fixedFillet' ? radius : undefined, how }
    if (ONLY && !ONLY.has(w)) continue
    // PERF=1: what the page holds as the workflows go by — time, heap,
    // listeners, DOM nodes — to tell a page that slows from one that hangs.
    // PERF=gc collects garbage first, so the counts are what the page keeps.
    if (process.env.PERF) { if (process.env.PERF === 'gc') { const c = await page.createCDPSession(); await c.send('HeapProfiler.collectGarbage'); await c.detach() } const m = await page.metrics(); console.log('PERF', w, Date.now(), Math.round(m.JSHeapUsedSize / 1e6), m.JSEventListeners, m.Nodes, m.LayoutCount, m.ScriptDuration.toFixed(1)) }
    try {
      await fresh()
      const far1 = add(C.p, C.d1, Math.max(gap[0], 0) + len[0]), near1 = add(C.p, C.d1, gap[0])
      const far2 = add(C.p, C.d2, Math.max(gap[1], 0) + len[1]), near2 = add(C.p, C.d2, gap[1])
      if (kind === 'polyline') {
        await button('[data-test=sketch-tool-polyline]')
        for (const p of [far1, C.p, far2]) await clickAt(p)
      } else {
        await button('[data-test=sketch-tool-line]')
        await clickAt(far1); await clickAt(near1)
        await clickAt(near2); await clickAt(far2)
      }
      await escape(2)
      if (await draftTool() !== 'select') { record(row, 'Escape twice did not return to the Modify tool'); continue }
      const drawn = await sketch()
      const lines = drawn.entities.filter((e) => e.kind === 'line')
      if (lines.length !== 2) { record(row, `drew ${drawn.entities.length} pieces (${drawn.entities.map((e) => e.kind)}) instead of 2 lines`); continue }
      // The line along side 1 is the one nearer far1.
      const [l1, l2] = Math.min(...endsOf(lines[0]).map((q) => dist(q, far1))) < Math.min(...endsOf(lines[1]).map((q) => dist(q, far1))) ? lines : [lines[1], lines[0]]
      const P = crossing(l1, l2)
      const joined = endsOf(l1).some((a) => endsOf(l2).some((b) => dist(a, b) < 1e-6))
      await button('[data-test=sketch-sharpen]')
      await button(`[data-test=corner-mode-${mode}]`)
      if (mode === 'fixedFillet') { await page.$eval('[data-test=corner-radius]', (e) => e.focus()); await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await page.keyboard.type(String(radius)); await page.keyboard.press('Tab'); await sleep(150) }
      const h0 = await history(), start = await sketch()
      // Where the hand sweeps: from on line 1 just past its near end (or just
      // inside it), round outside the corner point, onto line 2 the same way.
      const s1 = add(C.p, C.d1, Math.max(gap[0], 0) + 1.2), s2 = add(C.p, C.d2, Math.max(gap[1], 0) + 1.2)
      const out1 = -Math.max(0, -gap[0]) - 1.5, out2 = -Math.max(0, -gap[1]) - 1.5
      // Inside the line by half the brush's 7 px reach, so the ends of the
      // sweep still paint it: 0.6 mm was beyond the reach at this zoom, a
      // hand that never touched the line, which Corner Trim rightly refused.
      const off = gesture === 'box-off' ? 3.5 * (await page.evaluate(() => window.__re.sheet().unitsPerScreenPx())) : 0
      const path = gesture === 'stroke' ? [s1, s2]
        : gesture === 'loop' ? Array.from({ length: 13 }, (_, i) => { const a = (i / 12) * 1.5 * Math.PI, rr = Math.max(dist(s1, C.p), dist(s2, C.p)); const u = [C.d1[0], C.d1[1]], v = [C.d2[0], C.d2[1]]; const c = Math.cos(a), s = Math.sin(a); const dir = [u[0] * c - v[0] * s, u[1] * c - v[1] * s]; return i === 0 ? s1 : i === 12 ? s2 : add(C.p, dir, rr) })
        : [add(s1, C.d2, off), add(add(C.p, C.d1, out1 * 0.2), C.d2, out2), add(C.p, [C.d1[0] + C.d2[0], C.d1[1] + C.d2[1]], Math.min(out1, out2)), add(add(C.p, C.d2, out2 * 0.2), C.d1, out1), add(s2, C.d1, off)]
      await sweep(path)
      let msg = await message()
      if (await exists('[data-test=corner-accept]')) { await button('[data-test=corner-accept]'); msg = `${msg} / ${await message()}` }
      const done = await sketch(), steps = (await history()) - h0
      row.message = msg; row.steps = steps
      finite(done)
      const l1b = done.entities.find((e) => e.id === l1.id), l2b = done.entities.find((e) => e.id === l2.id)
      const arcs = done.entities.filter((e) => e.kind === 'arc')
      const coversCorner = gesture !== 'stroke'
      let problem = null
      if (!l1b || !l2b) problem = 'a line was removed'
      else if (mode === 'trim') {
        if (joined && dist(endsOf(l1).find((a) => endsOf(l2).some((b) => dist(a, b) < 1e-6)), P) < 1e-6) { if (steps !== 0) problem = `already-joined corner changed (${steps} steps)` }
        else if (steps !== 1) problem = `Corner Trim made ${steps} steps`
        else if (!(Math.min(...endsOf(l1b).map((q) => dist(q, P))) < 1e-6 && Math.min(...endsOf(l2b).map((q) => dist(q, P))) < 1e-6)) problem = 'Corner Trim did not end both lines at their crossing'
      } else {
        const expectArc = coversCorner && (mode === 'fixedFillet' || C.auto != null)
        if (expectArc) {
          if (arcs.length !== 1) problem = `expected one fillet arc, got ${arcs.length}`
          else {
            const a = arcs[0]; row.r = a.r
            if (mode === 'fixedFillet' && Math.abs(a.r - radius) > 1e-6) problem = `Fixed Size Fillet R ${a.r} instead of ${radius}`
            // A line drawn by mouse snaps to scan points: off the flat it lies, the
            // tangent arc that fits the round is smaller, ~3x the offset.
            const offFlat = Math.max(...[l1, l2].map((l, i) => { const d = i ? C.d2 : C.d1, n = [-d[1], d[0]]; return Math.max(...endsOf(l).map((q) => Math.abs((q[0] - C.p[0]) * n[0] + (q[1] - C.p[1]) * n[1]))) }))
            row.offFlat = +offFlat.toFixed(3)
            if (mode === 'autoFillet' && Math.abs(a.r - C.auto) > 0.25 + 4 * offFlat) problem = `Auto Fillet R ${a.r.toFixed(4)}, QUICKSURFACE ${C.auto}`
            const want = joined ? 1 : 2
            if (!problem && steps !== want) problem = `fillet took ${steps} undo steps, expected ${want}`
            if (!problem && done.constraints.filter((k) => k.kind === 'tangent' && (k.a === a.id || k.b === a.id)).length !== 2) problem = 'fillet not tangent to both lines'
            if (!problem) for (const piece of [l1b, l2b]) if (!(Math.min(...endsOf(piece).flatMap((p) => endsOf(a).map((q) => dist(p, q)))) < 1e-6)) problem = 'fillet does not meet a line'
          }
        } else {
          // No corner point painted, or a sharp scan corner: a sharp join.
          if (arcs.length) problem = `made an arc R ${arcs[0].r} where a sharp join was expected`
          else if (!(Math.min(...endsOf(l1b).map((q) => dist(q, P))) < 1e-6 && Math.min(...endsOf(l2b).map((q) => dist(q, P))) < 1e-6)) problem = joined ? (steps ? 'sharp corner moved' : null) : `no sharp join (${steps} steps)`
        }
      }
      // Far ends never move.
      if (!problem && l1b && l2b) {
        const farOf = (orig, now, farPt) => { const e = endsOf(orig).sort((p, q) => dist(p, farPt) - dist(q, farPt))[0]; return Math.min(...endsOf(now).map((q) => dist(q, e))) }
        if (farOf(l1, l1b, far1) > 1e-6 || farOf(l2, l2b, far2) > 1e-6) problem = 'a far end moved'
      }
      // Undo gives the lines back exactly; Redo the corner exactly.
      if (steps > 0) {
        await undo(steps, how)
        const back = await sketch()
        if (!problem && JSON.stringify(back) !== JSON.stringify(start)) problem = 'Undo did not restore the lines exactly: ' + diff(start, back)
        await redo(steps, how)
        const again = await sketch()
        if (!problem && JSON.stringify(again) !== JSON.stringify(done)) problem = 'Redo did not restore the corner exactly: ' + diff(done, again)
      }
      if (!problem && pageErrors.length) problem = 'page error: ' + pageErrors.join(' | ')
      if (!problem && consoleErrors.length) problem = 'console error: ' + consoleErrors.join(' | ')
      await button('[data-test=corner-cancel]').catch(() => {})
      if (!problem && await exists('[data-test=sketch-corner-trim-panel]')) problem = 'Corner panel still open after OK'
      if (problem) { row.drawn = { entities: start.entities, constraints: start.constraints }; row.after = diff(start, done); await page.screenshot({ path: `${out}/corner-${w}.png` }) }
      record(row, problem)
    } catch (e) { await page.screenshot({ path: `${out}/corner-${w}-error.png` }).catch(() => {}); record(row, 'exception: ' + String(e.message ?? e).slice(0, 300)) }
    pageErrors.length = 0; consoleErrors.length = 0
  }

  // ---- Drawing workflows ----
  // Tool, its clicks (in sketch mm about a centre), and what it adds.
  const TOOLS = {
    line: { sel: 'sketch-tool-line', clicks: (c) => [c, add(c, [between(4, 9), between(-4, 4)])], adds: { line: 1 } },
    polyline: { sel: 'sketch-tool-polyline', clicks: (c) => [c, add(c, [6, 0]), add(c, [6, 5]), add(c, [0, 7])], adds: { line: 3 } },
    rectangle: { sel: 'sketch-tool-rectangle', clicks: (c) => [c, add(c, [between(4, 9), between(3, 7)])], adds: { line: 4 } },
    circle: { sel: 'sketch-tool-circle', clicks: (c) => [c, add(c, [between(2, 5), 0])], adds: { circle: 1 } },
    circle3: { sel: 'sketch-tool-circle-three', clicks: (c) => [add(c, [-4, 0]), add(c, [0, 4]), add(c, [4, 0])], adds: { circle: 1 } },
    arc: { sel: 'sketch-tool-arc', clicks: (c) => [add(c, [-4, 0]), add(c, [4, 0]), add(c, [0, 3])], adds: { arc: 1 } },
    hexagon: { sel: 'sketch-tool-polygon', clicks: (c) => [c, add(c, [between(3, 5), 0])], adds: { line: 6 } },
  }
  const count = (s) => s.entities.reduce((a, e) => ({ ...a, [e.kind]: (a[e.kind] ?? 0) + 1 }), {})
  for (let w = 0; w < DRAWS; w++) {
    const steps = Array.from({ length: 2 + Math.floor(rnd() * 4) }, () => pick(Object.keys(TOOLS)))
    const how = rnd() < 0.5 ? 'key' : 'button'
    const row = { w, seed: SEED, draw: steps, how }
    try {
      await fresh()
      const h0 = await history(), empty = await sketch()
      const snapshots = []
      let problem = null
      for (const [i, t] of steps.entries()) {
        const before = count(await sketch())
        // Spread the pieces over the plate, apart from each other.
        const c = [-16 + (i % 3) * 13 + between(-1, 1), (i < 3 ? 6 : -10) + between(-1, 1)]
        await button(`[data-test=${TOOLS[t].sel}]`)
        const clicks = TOOLS[t].clicks(c)
        ;(row.actions ??= []).push({ tool: t, button: TOOLS[t].sel, clicks })
        for (const p of clicks) await clickAt(p)
        await escape(2)
        const now = await sketch(); snapshots.push(now)
        finite(now)
        const after = count(now)
        for (const [k, v] of Object.entries(TOOLS[t].adds)) if ((after[k] ?? 0) - (before[k] ?? 0) !== v) { problem ??= `${t} added ${(after[k] ?? 0) - (before[k] ?? 0)} ${k} (expected ${v})` }
        if (await draftTool() !== 'select') problem ??= `${t}: Escape twice did not return to the Modify tool`
      }
      const h1 = await history(), full = await sketch()
      row.steps = h1 - h0
      if (!problem) {
        await undo(h1 - h0, how)
        if (JSON.stringify(await sketch()) !== JSON.stringify(empty)) problem = 'undoing every step did not give back the empty sketch'
        await redo(h1 - h0, how)
        if (!problem && JSON.stringify(await sketch()) !== JSON.stringify(full)) problem = 'redoing every step did not give back the drawing'
      }
      // Select the first piece by clicking it, Ctrl+click another, Delete,
      // and undo the delete.
      if (!problem && full.entities.length >= 2) {
        const mid = (e) => e.kind === 'line' ? [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2] : e.kind === 'circle' ? [e.c[0] + e.r, e.c[1]] : endsOf(e)[0].map((v, k) => (v + endsOf(e)[1][k]) / 2)
        const pickable = full.entities.filter((e) => e.kind === 'line' || e.kind === 'circle')
        if (pickable.length >= 2) {
          const [ea, eb] = [pickable[0], pickable[pickable.length - 1]]
          await clickAt(mid(ea))
          const s1 = await page.evaluate(() => window.__re.store.getState().sketchDraft.selection)
          const pa = await screen(mid(eb)); await page.keyboard.down('Control'); await page.mouse.click(pa.x, pa.y); await page.keyboard.up('Control'); await sleep(150)
          const s2 = await page.evaluate(() => window.__re.store.getState().sketchDraft.selection)
          row.selection = [s1.length, s2.length]
          if (s1.length !== 1) problem = `click selected ${s1.length} pieces`
          else if (s2.length !== 2) problem = `Ctrl+click left ${s2.length} selected`
          else {
            const hd = await history()
            await page.keyboard.press('Delete'); await sleep(250)
            const del = await sketch()
            if (del.entities.length !== full.entities.length - 2) problem = `Delete removed ${full.entities.length - del.entities.length} pieces, 2 selected`
            await undo((await history()) - hd, how)
            if (!problem && JSON.stringify(await sketch()) !== JSON.stringify(full)) problem = 'undoing the Delete did not restore the drawing'
          }
          await escape(1)
        }
      }
      if (!problem && pageErrors.length) problem = 'page error: ' + pageErrors.join(' | ')
      if (!problem && consoleErrors.length) problem = 'console error: ' + consoleErrors.join(' | ')
      if (problem) await page.screenshot({ path: `${out}/draw-${w}.png` })
      record(row, problem)
    } catch (e) { await page.screenshot({ path: `${out}/draw-${w}-error.png` }).catch(() => {}); record(row, 'exception: ' + String(e.message ?? e).slice(0, 300)) }
    pageErrors.length = 0; consoleErrors.length = 0
  }
} finally {
  fs.writeFileSync(out + `/results-seed${SEED}.json`, JSON.stringify({ seed: SEED, total: results.length, failed: failures.length, failures, results }, null, 1))
  await browser.close()
}
const byKey = (rows, key) => rows.reduce((a, r) => { const k = key(r); a[k] = (a[k] ?? 0) + 1; return a }, {})
console.log(`${failures.length ? 'FAIL' : 'PASS'} sketch GUI workflows (seed ${SEED}): ${results.length - failures.length}/${results.length} passed`)
if (failures.length) console.log(JSON.stringify(byKey(failures, (r) => (r.mode ? `${r.corner} ${r.kind} ${r.mode} ${r.gesture}: ` : 'draw: ') + r.problem.replace(/[\d.]+/g, '#').slice(0, 90)), null, 1))
process.exit(failures.length ? 1 : 0)
