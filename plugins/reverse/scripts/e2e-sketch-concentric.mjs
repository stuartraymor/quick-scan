// SPDX-License-Identifier: AGPL-3.0-only
// 1.2.22, by mouse on the rendered sheet: two circles held about one
// centre, the three ways (the user's report, and cases C01–C05 / C12 of the
// dimension-constraint-measure brief):
//  - Coincident and Concentric are keys on the Constraints row, lit or
//    greyed by what is selected (two circles: Concentric and Equal, not
//    Parallel);
//  - two circles selected, Concentric: the second comes to the first, both
//    radii kept;
//  - Coincident in hand, the two centres clicked: the first stays marked
//    while the second is awaited, then the second centre comes to it;
//  - a circle's centre dragged onto the other's: held there by a
//    coincidence, its radius unchanged;
//  - a centre and the origin: held at both coordinates;
//  - two fixed circles: Concentric refused, and the hint says why.
// Every check reads the stored geometry, not the glyph.
import { writeFileSync } from 'node:fs'
import { check, click, finish, launchApp, loadScan, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { openReverse, reverseHelpers } from './lib.mjs'

const fixture = shotPath('concentric-cylinder-r10.obj'), n = 96, obj = []
for (const z of [-5, 5]) for (let i = 0; i < n; i++) obj.push(`v ${10 * Math.cos(i * Math.PI * 2 / n)} ${10 * Math.sin(i * Math.PI * 2 / n)} ${z}`)
obj.push('v 0 0 -5', 'v 0 0 5')
for (let i = 0; i < n; i++) { const a = i + 1, b = (i + 1) % n + 1, c = a + n, d = b + n; obj.push(`f ${a} ${b} ${d}`, `f ${a} ${d} ${c}`, `f ${2 * n + 1} ${b} ${a}`, `f ${2 * n + 2} ${c} ${d}`) }
writeFileSync(fixture, obj.join('\n'))

const { browser, page, consoleErrors } = await launchApp({ width: 1500, height: 960, protocolTimeout: 600_000 })
const { re } = reverseHelpers(page)
const at = (point) => re((p) => window.__re.sheet().sheetScreenPoint(p), point)
const pointClick = async (p, mods = []) => { const pixel = await at(p); await page.mouse.move(pixel.x, pixel.y); await sleep(100); for (const m of mods) await page.keyboard.down(m); await page.mouse.click(pixel.x, pixel.y); for (const m of mods) await page.keyboard.up(m); await sleep(200) }
const draft = () => re(() => { const d = window.__re.store.getState().sketchDraft; return { tool: d.tool, armed: d.armedRelation, entities: d.sketch.entities, constraints: d.sketch.constraints, selection: d.selection, relPicks: d.relPicks ?? [], error: d.error } })
const circles = async () => (await draft()).entities.filter((e) => e.kind === 'circle')
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1])
const keyState = (id) => page.$eval(`[data-test=${id}]`, (el) => ({ disabled: el.disabled, pressed: el.getAttribute('aria-pressed') === 'true', title: el.title, visible: (() => { const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.width > 0 && el.contains(top) })() }))
const undo = async () => { await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control'); await sleep(300) }
const rim = (c, deg = 45) => [c.c[0] + c.r * Math.cos(deg * Math.PI / 180), c.c[1] + c.r * Math.sin(deg * Math.PI / 180)]
try {
  await page.evaluate(() => localStorage.removeItem('scanruler.snapfilter'))
  await loadScan(page, fixture)
  await openReverse(page)
  if (await page.$('[data-test=support-card] .sc-x')) await click(page, '[data-test=support-card] .sc-x')
  await re(() => {
    window.__re.store.getState().startSketch({ kind: 'world', axis: 'z', offset: 0 }, { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] })
    window.__re.store.setState((s) => ({ sketchDraft: { ...s.sketchDraft, placing: true } }))
  })
  await page.waitForSelector('[data-test=place-create]')
  if (await page.$eval('[data-test=tool-inspector]', (el) => el.dataset.mode === 'floating')) await click(page, '[data-test=toggle-inspector-dock]')
  await click(page, '[data-test=place-create]')
  await page.waitForSelector('[data-test=sketch-editor]'); await sleep(800)
  // Circle A about (-7, 4), r 3; circle B about (8, 6), r 1.5 — clear of the axes.
  await click(page, '[data-test=sketch-tool-circle]')
  await pointClick([-7, 4]); await pointClick([-4, 4.6])
  await pointClick([8, 6]); await pointClick([9.2, 6.9])
  await click(page, '[data-test=sketch-tool-select]'); await page.keyboard.press('Escape'); await sleep(200)
  let [A, B] = await circles()
  check(A && B, `two circles drawn by mouse (${JSON.stringify([A?.c, A?.r, B?.c, B?.r])})`)
  const A0 = structuredClone(A), B0 = structuredClone(B)

  // ---- the keys ---------------------------------------------------------------
  const co = await keyState('sketch-rel-coincident'), cc = await keyState('sketch-rel-concentric')
  check(co.visible && cc.visible && !co.disabled && !cc.disabled, `Coincident and Concentric are keys on the Constraints row, on screen (${JSON.stringify([co, cc])})`)
  check(/share one centre/.test(cc.title) && /centres?/.test(co.title), `their tooltips say what they do (${cc.title} | ${co.title})`)

  // ---- C01: select both, Concentric ------------------------------------------
  await pointClick(rim(A)); await pointClick(rim(B), ['Shift'])
  check((await draft()).selection.length === 2, 'both circles selected by clicking their rims (Shift for the second)')
  const ctx = { concentric: await keyState('sketch-rel-concentric'), equal: await keyState('sketch-rel-equal'), parallel: await keyState('sketch-rel-parallel'), horizontal: await keyState('sketch-rel-horizontal') }
  check(!ctx.concentric.disabled && !ctx.equal.disabled && ctx.parallel.disabled && ctx.horizontal.disabled && /does not apply/.test(ctx.parallel.title), `two circles selected: Concentric and Equal offered, Parallel and Horizontal greyed with a reason (${JSON.stringify(Object.fromEntries(Object.entries(ctx).map(([k, v]) => [k, v.disabled])))})`)
  await click(page, '[data-test=sketch-rel-concentric]'); await sleep(400)
  let d = await draft();[A, B] = await circles()
  check(d.constraints.some((c) => c.kind === 'concentric') && !d.error, `Concentric added (${JSON.stringify(d.constraints.map((c) => c.kind))} ${d.error ?? ''})`)
  check(dist(A.c, A0.c) < 1e-6 && dist(B.c, A0.c) < 1e-6, `the first selected kept its centre; the second came to it (A ${A.c}, B ${B.c})`)
  check(Math.abs(A.r - A0.r) < 1e-9 && Math.abs(B.r - B0.r) < 1e-9, `both radii unchanged (${A.r}, ${B.r})`)
  await page.screenshot({ path: shotPath('01-concentric.png') })
  await undo()
  ;[A, B] = await circles()
  check(dist(B.c, B0.c) < 1e-9 && !(await draft()).constraints.some((c) => c.kind === 'concentric'), 'Undo: B back where it was, the relation gone')

  // ---- C02: Coincident in hand, the centres clicked --------------------------
  await page.keyboard.press('Escape'); await sleep(150)
  await click(page, '[data-test=sketch-tool-line]')
  await click(page, '[data-test=snap-center]')
  await click(page, '[data-test=sketch-rel-coincident]'); await sleep(200)
  check(!(await keyState('snap-center')).pressed, 'Coincident inherits Centre off from drawing')
  await pointClick(B0.c)
  check(!(await draft()).relPicks.length, 'Centre off excludes a circle center from Coincident')
  await click(page, '[data-test=snap-center]')
  await click(page, '[data-test=sketch-tool-line]')
  check((await keyState('snap-center')).pressed, 'Drawing sees Centre enabled from Coincident')
  await click(page, '[data-test=sketch-rel-coincident]')
  d = await draft()
  check(d.tool === 'relation' && d.armed === 'coincident' && (await keyState('sketch-rel-coincident')).pressed, 'nothing selected: Coincident is taken in hand, its key pressed')
  await page.evaluate(() => { const v = window.__re.sheet(); const orig = v.setFlatDots.bind(v); v.setFlatDots = (dots) => { window.__dots = dots.map((x) => ({ at: x.at, color: x.color })); return orig(dots) } })
  await pointClick(B0.c)
  d = await draft()
  check(d.relPicks.length === 1 && d.relPicks[0].kind === 'point' && d.relPicks[0].anchor.at === 'center' && d.relPicks[0].anchor.entity === B0.id, `B's centre clicked is the first pick (${JSON.stringify(d.relPicks)})`)
  const far = await at([0, -8]); await page.mouse.move(far.x, far.y); await sleep(300)
  const marked = await page.evaluate((c) => (window.__dots ?? []).some((x) => Math.hypot(x.at[0] - c[0], x.at[1] - c[1]) < 1e-6 && x.color !== '#62aae4'), B0.c)
  check(marked, 'with the mouse away, the picked centre stays marked on the sheet')
  await pointClick(A0.c)
  d = await draft();[A, B] = await circles()
  const cc2 = d.constraints.find((c) => c.kind === 'coincident')
  check(cc2 && cc2.p.at === 'center' && cc2.q.at === 'center', `a coincidence of the two centres (${JSON.stringify(cc2)})`)
  check(dist(B.c, B0.c) < 1e-6 && dist(A.c, B0.c) < 1e-6 && Math.abs(A.r - A0.r) < 1e-9, `the first picked (B) stayed, A came to it, A's radius kept (A ${A.c}, B ${B.c})`)
  check(d.armed === 'coincident', 'Coincident stays in hand for the next pair')
  await page.screenshot({ path: shotPath('02-coincident-centres.png') })
  await undo(); await page.keyboard.press('Escape'); await sleep(200)
  await click(page, '[data-test=sketch-tool-select]'); await sleep(150)

  // ---- C03: drag B's centre onto A's ------------------------------------------
  ;[A, B] = await circles()
  const from = await at(B.c), to = await at(A.c)
  await page.mouse.move(from.x, from.y); await sleep(120); await page.mouse.down(); await sleep(60)
  for (let i = 1; i <= 12; i++) { await page.mouse.move(from.x + (to.x - from.x) * i / 12 + (i === 12 ? 2 : 0), from.y + (to.y - from.y) * i / 12 + (i === 12 ? -1 : 0)); await sleep(40) }
  await page.mouse.up(); await sleep(500)
  d = await draft();[A, B] = await circles()
  check(dist(B.c, A.c) < 1e-6 && d.constraints.some((c) => c.kind === 'coincident' && c.p.at === 'center' && c.q.at === 'center'), `B's centre dropped a hair off A's: snapped onto it and held there (${JSON.stringify(d.constraints.map((c) => c.kind))})`)
  check(Math.abs(B.r - B0.r) < 1e-9 && dist(A.c, A0.c) < 1e-6, `B moved whole — radius ${B.r} kept — and A stayed`)
  await undo()

  // ---- two circles + Coincident: their centres meet ---------------------------
  ;[A, B] = await circles()
  await pointClick(rim(A, 200)); await pointClick(rim(B, 200), ['Shift'])
  await click(page, '[data-test=sketch-rel-coincident]'); await sleep(400)
  d = await draft();[A, B] = await circles()
  check(!d.error && dist(B.c, A0.c) < 1e-6 && Math.abs(B.r - B0.r) < 1e-9, `two circles selected with Coincident: B's centre on A's, its radius kept (before: one centre on the other's rim and the radius grown) — ${d.error ?? ''}`)
  await undo()

  // ---- C05: a centre and the origin ------------------------------------------
  await page.keyboard.press('Escape')
  await click(page, '[data-test=sketch-rel-coincident]'); await sleep(150)
  await pointClick(B0.c); await pointClick([0.15, -0.1])
  d = await draft();[A, B] = await circles()
  check(dist(B.c, [0, 0]) < 1e-6 && d.constraints.filter((c) => c.kind === 'pointOn').length === 2, `B's centre and the origin: held at (0, 0) on both axes (${B.c}; ${JSON.stringify(d.constraints.map((c) => c.kind))})`)
  await page.screenshot({ path: shotPath('03-origin.png') })
  await undo(); await page.keyboard.press('Escape')
  await click(page, '[data-test=sketch-tool-select]'); await sleep(150)

  // ---- C12: two fixed circles --------------------------------------------------
  ;[A, B] = await circles()
  await pointClick(rim(A)); await pointClick(rim(B), ['Shift'])
  await click(page, '[data-test=sketch-fix]'); await sleep(300)
  await pointClick(rim(A)); await pointClick(rim(B), ['Shift'])
  const before = JSON.stringify((await draft()).entities)
  await click(page, '[data-test=sketch-rel-concentric]'); await sleep(400)
  d = await draft()
  const hint = await page.$eval('[data-test=sketch-hint]', (el) => { const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + 4, r.top + r.height / 2); return { text: el.textContent, onScreen: r.width > 0 && el.contains(top) } })
  check(JSON.stringify(d.entities) === before && !d.constraints.some((c) => c.kind === 'concentric'), 'two fixed circles: Concentric not added, nothing moved')
  check(/both fixed/.test(hint.text) && hint.onScreen, `and the hint on screen says why (${hint.text})`)
  await page.screenshot({ path: shotPath('04-fixed-refused.png') })
} catch (error) { check(false, error.stack ?? error.message) }
await finish(browser, consoleErrors)
