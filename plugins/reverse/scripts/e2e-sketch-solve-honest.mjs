// SPDX-License-Identifier: AGPL-3.0-only
// 1.2.11: what the 2D Sketch calls solved is solved, by real clicks on the
// ribbon, the sheet and the dimension's own field (the dev hook only lays
// out the starting pieces and reads the result):
//
// - Symmetric in hand, mirrored about the ZX plane's line, on a polyline
//   whose second line is held level: refused on the hint line with the
//   reason (a line shrunk to a point, or laid on the other — which comes
//   first depends on where the lines lie), the sketch as it was. Before, both lines shrank to a point and
//   the sketch read as solved.
// - The same on a V with nothing held: the joint goes onto the plane's
//   line and the far ends mirror.
// - The hint line that says so is on screen, not in the closed
//   "Sketch settings and additional tools" section.
// - An angle put down by the Dimension tool takes 200° (its corner's
//   sweep) and refuses 400° and −30° with a sentence.
// - A distance from an arc's end to a line's end, typed small: met, with
//   the arc's ends where the solve put them.
//
//   node plugins/reverse/scripts/e2e-sketch-solve-honest.mjs
import fs from 'node:fs'
import { launchApp, loadScan, sleep, shotPath, check, finish } from '../../../scripts/e2e-lib.mjs'
import { openReverse } from './lib.mjs'

const out = shotPath('sketch-solve-honest'); fs.mkdirSync(out, { recursive: true })
const mesh = []; for (const z of [-5, 5]) for (let i = 0; i < 160; i++) { const a = i * Math.PI / 80; mesh.push(`v ${10 * Math.cos(a)} ${10 * Math.sin(a)} ${z}`) }
mesh.push('v 0 0 -5', 'v 0 0 5'); for (let i = 0; i < 160; i++) { const a = i + 1, b = (i + 1) % 160 + 1; mesh.push(`f ${a} ${b} ${b + 160}`, `f ${a} ${b + 160} ${a + 160}`, `f 321 ${b} ${a}`, `f 322 ${a + 160} ${b + 160}`) }
const meshPath = out + '/cylinder.obj'; fs.writeFileSync(meshPath, mesh.join('\n'))
const { browser, page, consoleErrors } = await launchApp({ width: 1700, height: 1050 })
const read = () => page.evaluate(() => { const d = window.__re.store.getState().sketchDraft; return d && { sketch: d.sketch, history: d.history.length, error: d.error, report: d.report, selectedConstraint: d.selectedConstraint } })
const screen = (p) => page.evaluate((p) => window.__re.sheet().sheetScreenPoint(p), p)
const at = async (p) => { const s = await screen(p); await page.mouse.move(s.x + 3, s.y); await sleep(40); await page.mouse.move(s.x, s.y); await sleep(60); await page.mouse.click(s.x, s.y); await sleep(200) }
const press = async (k, mod) => { if (mod) await page.keyboard.down(mod); await page.keyboard.press(k); if (mod) await page.keyboard.up(mod); await sleep(220) }
const button = async (test) => { const el = await page.$(`[data-test=${test}]`); if (!el) throw new Error('no button ' + test); await el.click(); await sleep(200) }
const hint = () => page.$eval('[data-test=sketch-hint]', (e) => e.textContent).catch(() => null)
const pxPerMm = async () => { const o = await screen([0, 0]), u = await screen([1, 0]); return Math.hypot(u.x - o.x, u.y - o.y) }
const fitView = async () => { for (let k = 0; k < 40; k++) { const s = await pxPerMm(); if (s > 4.5 && s < 8) break; await page.mouse.move(1350, 560); await page.mouse.wheel({ deltaY: s >= 8 ? -60 : 60 }); await sleep(150) } }
const reset = async (entities) => { await page.evaluate((entities) => { const r = window.__re.store; r.setState({ sketchDraft: null }); r.getState().startSketch({ kind: 'world', axis: 'z', offset: 0 }, { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }, entities) }, entities); await sleep(500); await fitView() }
const escape = async () => { for (let i = 0; i < 3; i++) await press('Escape') }
const ent = (d, id) => d.sketch.entities.find((e) => e.id === id)
const typeInto = async (id, v) => {
  const sel = `[data-test=flat-dimension-${id}]`
  let input = await page.$(`${sel} input`)
  if (!input) { const lab = await page.$(sel); if (!lab) throw new Error('no number on the sheet for dimension ' + id); const b = await lab.boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { count: 2 }); await sleep(250); input = await page.$(`${sel} input`) }
  if (!input) throw new Error('the number did not open for typing')
  await input.focus(); await press('a', 'Control'); await page.keyboard.type(String(v)); await press('Enter'); await sleep(300)
}
const result = {}

try {
  await loadScan(page, meshPath); await openReverse(page)

  // ---- Symmetric about a plane's line on a polyline held level --------------------
  await reset([])
  await button('sketch-tool-polyline')
  for (const p of [[-25, 30], [-5, 45], [15, 45]]) await at(p)
  await escape()
  let d = await read()
  check(d.sketch.entities.length === 2 && d.sketch.constraints.some((c) => c.kind === 'horizontal'), `a polyline of two lines, the second held level (${d.sketch.entities.length} pieces; ${d.sketch.constraints.map((c) => c.kind).join(',')})`)
  const kept = JSON.stringify(d.sketch.entities), steps = d.history
  await button('sketch-rel-symmetric')
  await at([-15, 37.5]); await at([5, 45]); await at([-35, 0])
  d = await read(); result.refusal = await hint()
  await page.screenshot({ path: `${out}/01-symmetric-refused.png` })
  check(/^Symmetric was not applied: it would (lay line 1 on top of line 2|shrink line [12] to a point). Nothing was changed.$/.test(result.refusal ?? ''), `the hint line says why Symmetric was refused: "${result.refusal}"`)
  const shown = await page.$eval('[data-test=sketch-hint]', (e) => { const r = e.getBoundingClientRect(); const probe = document.createElement('span'); probe.style.color = 'var(--amber)'; e.appendChild(probe); const amber = getComputedStyle(probe).color; probe.remove(); return { w: r.width, h: r.height, inClosed: Boolean(e.closest('details:not([open])')), top: r.top, color: getComputedStyle(e).color, amber } }).catch(() => null)
  result.hintBox = shown
  check(shown && shown.w > 0 && shown.h > 0 && !shown.inClosed && shown.top < 1050 && shown.color === shown.amber, `the reason is on screen in amber, not inside a closed section (${JSON.stringify(shown)})`)
  check(JSON.stringify(d.sketch.entities) === kept && d.history === steps && !d.sketch.constraints.some((c) => c.kind === 'symmetric'), 'and the sketch is as it was, with no step to undo')
  await escape()

  // ---- the same on a V with nothing held -----------------------------------------
  await reset([])
  await button('sketch-tool-polyline')
  for (const p of [[-25, 30], [-5, 45], [16, 31]]) await at(p)
  await escape()
  d = await read()
  check(d.sketch.entities.length === 2 && !d.sketch.constraints.some((c) => c.kind === 'horizontal' || c.kind === 'vertical'), 'a V of two lines, neither held level nor upright')
  await button('sketch-rel-symmetric')
  await at([-15, 37.5]); await at([5.5, 38]); await at([0, -30])
  d = await read()
  await page.screenshot({ path: `${out}/02-symmetric-v.png` })
  const [l1, l2] = d.sketch.entities
  const v = { joint: l1.b, a: l1.a, b: l2.b, ok: d.report?.ok, error: d.error }
  result.v = v
  check(!d.error && d.report?.ok && Math.abs(l1.b[0]) < 1e-6 && Math.abs(l1.a[0] + l2.b[0]) < 1e-6 && Math.abs(l1.a[1] - l2.b[1]) < 1e-6 && Math.hypot(l1.b[0] - l1.a[0], l1.b[1] - l1.a[1]) > 15, `the V mirrors about the YZ plane's line, its joint on it (${JSON.stringify(v)})`)
  await press('z', 'Control'); d = await read()
  check(!d.sketch.constraints.some((c) => c.kind === 'symmetric'), 'Ctrl+Z takes Symmetric back')
  await escape()

  // ---- an angle put down by the Dimension tool -----------------------------------
  await reset([{ kind: 'line', a: [0, 0], b: [30, 0] }, { kind: 'line', a: [0, 5], b: [20, 25] }])
  await button('sketch-dimension')
  await at([15, 0]); await at([10, 15]); await at([25, 12])
  d = await read()
  const angle = d.sketch.constraints.find((c) => c.kind === 'angle')
  check(Boolean(angle), `the Dimension tool put an angle down (${d.sketch.constraints.map((c) => c.kind).join(',') || 'none'}; ${d.error ?? ''})`)
  result.sector = angle?.sector ?? null
  await typeInto(angle.id, 120)
  d = await read()
  check(!d.error && d.sketch.constraints.find((c) => c.id === angle.id)?.value === 120 && d.report?.ok, `120° is taken (${d.error ?? 'solved'})`)
  const before = JSON.stringify(d.sketch)
  const range = angle.sector ? 'An angle in a corner is from 0° up to, not including, 360°.' : 'The angle between two lines is from 0° to 180°.'
  for (const bad of angle.sector ? [400, -30] : [200, -30]) {
    await typeInto(angle.id, bad)
    d = await read(); const said = await hint()
    check(said === range && JSON.stringify(d.sketch) === before, `${bad}° is refused on the hint line, nothing changed: "${said}"`)
    await escape()
  }
  await page.screenshot({ path: `${out}/03-angle-refused.png` })

  // ---- a distance from an arc's end to a line's end ------------------------------
  await reset([{ kind: 'arc', c: [0, 0], r: 10, start: 0, sweep: Math.PI / 2 }, { kind: 'line', a: [40, -10], b: [40, 20], fixed: true }])
  await button('sketch-dimension')
  await at([10, 0]); await at([40, -10]); await at([25, -4]) // put down between the points: the straight distance (1.2.17: above or below would be the horizontal one)
  d = await read()
  const dist = d.sketch.constraints.find((c) => c.kind === 'distance')
  check(Boolean(dist) && dist.p.at !== 'center' && 'entity' in dist.q && dist.q.at !== 'center', `the Dimension tool measured end to end (${JSON.stringify(dist)})`)
  await typeInto(dist.id, 0.001)
  d = await read()
  const pt = (a) => { const e = ent(d, a.entity); if (e.kind === 'line') return a.at === 'a' ? e.a : e.b; const t = a.at === 'a' ? e.start : e.start + e.sweep; return [e.c[0] + e.r * Math.cos(t), e.c[1] + e.r * Math.sin(t)] }
  const c = d.sketch.constraints.find((x) => x.id === dist.id)
  const gap = Math.hypot(pt(c.p)[0] - pt(c.q)[0], pt(c.p)[1] - pt(c.q)[1])
  result.arcGap = { gap, ok: d.report?.ok, arc: ent(d, 1) }
  await page.screenshot({ path: `${out}/04-arc-end-distance.png` })
  check(d.report?.ok && Math.abs(gap - 0.001) < 1e-6, `typed 0.001 between the arc's end and the line's end, and they are 0.001 apart (${gap})`)
} catch (e) {
  console.log('FAIL:', e?.message ?? e)
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {})
  process.exitCode = 1
}
fs.writeFileSync(`${out}/result.json`, JSON.stringify(result, null, 2))
await finish(browser, consoleErrors)
