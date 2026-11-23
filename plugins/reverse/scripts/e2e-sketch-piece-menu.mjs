// SPDX-License-Identifier: AGPL-3.0-only
// 1.2.26, by mouse: the sketch's right-click menu on a circle or an arc
// (the brief's Part 8.8), "Select other" where pieces or centres lie on top
// of each other (selection cycling, test C16), and the panel's "Selected
// only" list. Two concentric circles A (r 10) and B (r 5) about the origin,
// a circle C (r 4) about (30, 10), and a line along y = −12.
//
// Prereqs: dev server running (npm run dev), Chrome installed.
//   node plugins/reverse/scripts/e2e-sketch-piece-menu.mjs
// Env: CHROME (chrome.exe path), APP_URL, SHOT_DIR.
import { writeFileSync } from 'node:fs'
import { check, click, finish, launchApp, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { reverseHelpers } from './lib.mjs'

const { browser, page, consoleErrors } = await launchApp({ width: 1600, height: 1000, protocolTimeout: 600_000 })
const { re } = reverseHelpers(page)
const onSheet = (p) => re((q) => window.__re.sheet().sheetScreenPoint(q), p)
const onCanvas = (q) => page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName === 'CANVAS', q)
const at = async (p) => {
  const q = await onSheet(p)
  if (!q || !(await onCanvas(q))) throw new Error(`${JSON.stringify(p)} is not on the view (${JSON.stringify(q)})`)
  return q
}
const rightClick = async (p) => { const q = await at(p); await page.mouse.move(q.x, q.y); await sleep(80); await page.mouse.click(q.x, q.y, { button: 'right' }); await sleep(250) }
const leftClick = async (p) => { const q = await at(p); await page.mouse.move(q.x, q.y); await sleep(80); await page.mouse.click(q.x, q.y); await sleep(250) }
const menu = () => page.evaluate(() => {
  const m = document.querySelector('[data-test=sketch-piece-menu]')
  if (!m) return null
  const r = m.getBoundingClientRect()
  return {
    title: m.querySelector('.hint')?.textContent ?? '',
    items: [...m.querySelectorAll('button[role=menuitem]:not([data-test=sketch-menu-other])')].map((b) => ({ test: b.dataset.test, label: b.textContent, enabled: !b.disabled, title: b.title })),
    others: [...m.querySelectorAll('[data-test=sketch-menu-other]')].map((b) => b.textContent),
    head: m.querySelector('[data-test=sketch-menu-others-head]')?.textContent ?? null,
    onScreen: r.width > 0 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1,
  }
})
const draft = () => re(() => {
  const d = window.__re.store.getState().sketchDraft
  return {
    tool: d.tool, armed: d.armedRelation, selection: d.selection, relPicks: d.relPicks ?? [], dimMade: d.dimMade ?? null,
    entities: d.sketch.entities.map((e) => ({ id: e.id, kind: e.kind, c: e.c ?? null, r: e.r ?? null, a: e.a ?? null, fixed: !!e.fixed })),
    constraints: d.sketch.constraints.map((c) => ({ id: c.id, kind: c.kind, entity: c.entity ?? null, a: c.a ?? null, b: c.b ?? null, p: c.p ?? null, q: c.q ?? null })),
    error: d.error,
  }
})
const byTest = (m, test) => m.items.find((i) => i.test === test)
const near = (a, b, tol = 1e-5) => Math.abs(a - b) <= tol
const log = {}

await page.click('[data-test=workspace-reverse]')
await page.waitForSelector('[data-test=kernel-status]')
await sleep(300)
const ids = await re(() => {
  const s = () => window.__re.store.getState()
  s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }, [
    { kind: 'circle', c: [0, 0], r: 10 },
    { kind: 'circle', c: [0, 0], r: 5 },
    { kind: 'circle', c: [30, 10], r: 4 },
    { kind: 'line', a: [20, -12], b: [40, -12] },
  ])
  s().setSketchTool('select')
  const [A, B, C, L] = s().sketchDraft.sketch.entities.map((e) => e.id)
  return { A, B, C, L }
})
await sleep(600)
// The sheet opens wherever it last was: frame the sketch, with room round it.
// What the script clicks lies right of the origin; the left of A may sit
// under the panel.
const corners = [[-1, -14], [-1, 21], [44, -14], [44, 21]]
await re(() => window.__re.sheet().frame())
await sleep(400)
check((await Promise.all(corners.map(async (p) => { const q = await onSheet(p); return !!q && (await onCanvas(q)) }))).every(Boolean), 'the sketch, right of the origin, is on the view')

// ---- Select other at the two circles' one centre ------------------------------------------
await rightClick([0.05, 0])
let m = await menu()
check(m !== null && m.onScreen, `a right click at the shared centre opens the sketch's menu (${JSON.stringify(m)})`)
check(m.head === 'Select other — 2 here' && m.others.length === 2, `it offers Select other, two things there (${JSON.stringify(m.others)})`)
check(m.others.some((t) => t.startsWith(`Circle ${ids.A}`)) && m.others.some((t) => t.startsWith(`Circle ${ids.B}`)) && /\(nearest\)$/.test(m.others[0]), `both circles, the nearest marked (${JSON.stringify(m.others)})`)
await page.screenshot({ path: shotPath('menu-1-select-other.png') })
const second = m.others[1].startsWith(`Circle ${ids.A}`) ? ids.A : ids.B
await page.click('[data-test=sketch-menu-other][data-index="1"]')
await sleep(250)
let d = await draft()
check(JSON.stringify(d.selection) === JSON.stringify([second]) && (await menu()) === null, `choosing the second selects it, and the menu goes (${JSON.stringify(d.selection)} wanted [${second}])`)
await rightClick([0.05, 0])
const firstAgain = (await menu()).others[0]
await page.click('[data-test=sketch-menu-other][data-index="0"]')
await sleep(200)
d = await draft()
check(d.selection.length === 1 && firstAgain.startsWith(`Circle ${d.selection[0]}`), `choosing the first selects the nearest (${firstAgain} → ${JSON.stringify(d.selection)})`)

// ---- the circle menu -----------------------------------------------------------------
await rightClick([34, 10])
m = await menu()
check(m && m.title === `Circle ${ids.C}` && m.others.length === 0, `a right click on circle C's rim opens its menu, nothing else there (${JSON.stringify(m && { title: m.title, others: m.others })})`)
check(JSON.stringify(m.items.map((i) => i.label)) === JSON.stringify(['Select centrepoint', 'Concentric with…', 'Equal radius with…', 'Fix', 'Dimension diameter', 'Dimension radius', 'View relations']), `its commands, in the brief's order (${JSON.stringify(m.items.map((i) => i.label))})`)
check(m.items.every((i) => i.enabled), 'all enabled: there are other circles, and no size dimension yet')
await page.screenshot({ path: shotPath('menu-2-circle.png') })

await page.keyboard.press('Escape'); await sleep(200)
check((await menu()) === null, 'Escape puts the menu away')

// Dimension diameter: in hand, put down with a click on the sheet.
await rightClick([34, 10])
await page.click('[data-test=sketch-menu-diameter]'); await sleep(250)
d = await draft()
const dia = d.constraints.find((c) => c.id === d.dimMade)
check(d.tool === 'dimension' && dia?.kind === 'diameter' && dia.entity === ids.C, `Dimension diameter puts C's diameter in hand (${JSON.stringify(dia)})`)
await leftClick([30, 20]); await sleep(300)
await re(() => document.activeElement?.blur?.())
d = await draft()
check(d.dimMade === null && d.constraints.some((c) => c.kind === 'diameter' && c.entity === ids.C), 'a click on the sheet puts it down')
await re(() => window.__re.store.getState().setSketchTool('select')); await sleep(150)
await rightClick([34, 10])
m = await menu()
check(!byTest(m, 'sketch-menu-radius').enabled && /has a diameter dimension already/.test(byTest(m, 'sketch-menu-radius').title), `now Dimension radius is greyed, saying why (${byTest(m, 'sketch-menu-radius').title})`)

// Concentric with…: C picked, then A's rim clicked.
await page.click('[data-test=sketch-menu-concentric]'); await sleep(250)
d = await draft()
check(d.tool === 'relation' && d.armed === 'concentric' && JSON.stringify(d.selection) === JSON.stringify([ids.C]), `Concentric with… holds C and waits (${JSON.stringify({ tool: d.tool, armed: d.armed, sel: d.selection })})`)
await leftClick([10, 0]); await sleep(300)
d = await draft()
const cOf = (id) => d.entities.find((e) => e.id === id).c
check(d.constraints.some((c) => c.kind === 'concentric') && near(cOf(ids.A)[0], cOf(ids.C)[0]) && near(cOf(ids.A)[1], cOf(ids.C)[1]), `a click on A's rim makes A and C concentric (A ${JSON.stringify(cOf(ids.A))}, C ${JSON.stringify(cOf(ids.C))})`)
log.concentric = { A: cOf(ids.A), C: cOf(ids.C) }

// ---- View relations and Selected only -----------------------------------------------------
// B gets a radius of its own, so the list has a row that is not C's.
await re((B) => {
  const s = () => window.__re.store.getState()
  s().setSketchTool('select')
  window.__re.store.setState((st) => ({ sketchDraft: { ...st.sketchDraft, selection: [B] } }))
  s().addDimension('radius')
  window.__re.store.setState((st) => ({ sketchDraft: { ...st.sketchDraft, selection: [], dimMade: null } }))
}, ids.B)
await sleep(300)
await re(() => document.activeElement?.blur?.())
const allRows = await page.$$eval('[data-test=sketch-dimension-row], [data-test=sketch-relation-row]', (r) => r.length)
const cRim = [cOf(ids.C)[0] + 4, cOf(ids.C)[1]]
await rightClick(cRim)
await page.click('[data-test=sketch-menu-relations]'); await sleep(300)
d = await draft()
const box = await page.$eval('[data-test=sketch-relations-selected-only]', (el) => el.checked)
const rows = await page.$$eval('[data-test=sketch-dimension-row] .name, [data-test=sketch-relation-row] .name', (r) => r.map((x) => x.textContent.trim()))
check(JSON.stringify(d.selection) === JSON.stringify([ids.C]) && box, `View relations selects C and ticks Selected only (${JSON.stringify(d.selection)}, ${box})`)
check(allRows === 3 && rows.length === 2 && rows.every((t) => t.includes(`circle ${ids.C}`)), `only C's diameter and its Concentric are listed, not B's radius (${JSON.stringify(rows)}, of ${allRows})`)
await page.screenshot({ path: shotPath('menu-3-view-relations.png') })
await re(() => window.__re.store.getState().clearSelection()); await sleep(200)
const none = await page.$eval('[data-test=sketch-relations-none]', (el) => el.textContent).catch(() => null)
check(none === 'Select pieces to see their relations.', `with nothing selected it says so (${none})`)
await click(page, '[data-test=sketch-relations-selected-only]'); await sleep(200)
const back = await page.$$eval('[data-test=sketch-dimension-row], [data-test=sketch-relation-row]', (r) => r.length)
check(back === allRows, `unticked, every row is back (${back} of ${allRows})`)

// ---- Select centrepoint, and Select other with Coincident in hand ----------------------------
await rightClick([5, 0])
m = await menu()
check(m.title === `Circle ${ids.B}`, `a right click on B's rim opens B's menu (${m.title})`)
await page.click('[data-test=sketch-menu-centre]'); await sleep(250)
d = await draft()
check(d.armed === 'coincident' && JSON.stringify(d.relPicks) === JSON.stringify([{ kind: 'point', anchor: { entity: ids.B, at: 'center' } }]), `Select centrepoint arms Coincident with B's centre picked (${JSON.stringify(d.relPicks)})`)
await page.keyboard.press('Escape'); await sleep(150)
await re(() => window.__re.store.getState().armRelation('coincident')); await sleep(150)
// A now shares C's centre (Concentric above): two centres on one spot.
const shared = cOf(ids.C)
await rightClick([shared[0] + 0.05, shared[1]])
m = await menu()
const centres = m?.others ?? []
check(centres.length >= 2 && centres.filter((t) => /^Centre of circle/.test(t)).length >= 2, `with Coincident in hand, Select other lists the centres on top of each other (${JSON.stringify(centres)})`)
// The one a plain click would not take.
const pickIndex = centres.findIndex((t, i) => i > 0 && /^Centre of circle/.test(t))
const chosen = Number(centres[pickIndex].match(/circle (\d+)/)[1])
await page.click(`[data-test=sketch-menu-other][data-index="${pickIndex}"]`); await sleep(250)
d = await draft()
check(JSON.stringify(d.relPicks) === JSON.stringify([{ kind: 'point', anchor: { entity: chosen, at: 'center' } }]), `choosing the centre of circle ${chosen} makes it Coincident's first pick (${JSON.stringify(d.relPicks)})`)
await leftClick([20, -12]); await sleep(300)
d = await draft()
const held = d.constraints.find((c) => c.kind === 'coincident')
check(held && held.p?.entity === chosen && held.p?.at === 'center' && held.q?.entity === ids.L, `a click on the line's end holds it to that centre (${JSON.stringify(held)})`)
log.coincident = held

// ---- where the menu does not open -------------------------------------------------------
await re(() => window.__re.store.getState().setSketchTool('line')); await sleep(150)
const rimC = [cOf(ids.C)[0] + 4, cOf(ids.C)[1]]
await rightClick(rimC)
check((await menu()) === null, 'with the Line tool in hand the sketch menu stays shut')
await page.keyboard.press('Escape'); await sleep(150)
await re(() => window.__re.store.getState().setSketchTool('select')); await sleep(150)
const q = await at(rimC)
await page.mouse.move(q.x, q.y); await page.mouse.down({ button: 'right' }); await page.mouse.move(q.x + 40, q.y + 30, { steps: 6 }); await page.mouse.up({ button: 'right' }); await sleep(250)
check((await menu()) === null, 'a right-drag (the view\'s pan) opens no menu')
// Linux and macOS send the context menu on press, before any drag (GitHub's
// CI found it): replay that order. The menu waits for the release, and opens
// only when the pointer stayed put.
const pressOrder = (p, moved) => page.evaluate(({ x, y, moved }) => {
  const el = document.elementFromPoint(x, y), o = { bubbles: true, cancelable: true, composed: true, button: 2, clientX: x, clientY: y }
  el.dispatchEvent(new PointerEvent('pointerdown', { ...o, buttons: 2, pointerId: 1 }))
  const taken = !el.dispatchEvent(new MouseEvent('contextmenu', { ...o, buttons: 2 }))
  el.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0, pointerId: 1, clientX: x + moved, clientY: y + moved }))
  return `${el.tagName}.${el.className} taken=${taken}`
}, { x: p.x, y: p.y, moved })
// A spot on C's rim with the canvas itself under it (relation glyphs sit on
// some of the rim).
let bare = null
for (const t of [0, 1, 2, 3, 4, 5].map((k) => (k * Math.PI) / 3 + 0.4)) {
  const p = await at([cOf(ids.C)[0] + 4 * Math.cos(t), cOf(ids.C)[1] + 4 * Math.sin(t)])
  if ((await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, p)) === 'CANVAS') { bare = p; break }
}
check(bare !== null, "a bare spot on C's rim to press on")
const tag = await pressOrder(bare, 30); await sleep(250)
check((await menu()) === null, `menu sent on press, then a drag: no menu (${tag})`)
await pressOrder(bare, 0); await sleep(250)
const pressed = await menu()
check(pressed?.title === `Circle ${ids.C}`, `menu sent on press, released in place: C's menu opens (${pressed?.title})`)
await page.keyboard.press('Escape'); await sleep(150)
// The stage's own menu (a drawing tool in hand) waits for the release too.
await re(() => window.__re.store.getState().setSketchTool('line')); await sleep(150)
const stageMenu = () => page.evaluate(() => document.querySelector('[data-test=viewport-menu]') !== null)
await pressOrder(bare, 30); await sleep(250)
check(!(await stageMenu()), 'stage menu sent on press, then a drag: no menu')
await pressOrder(bare, 0); await sleep(250)
check(await stageMenu(), 'stage menu sent on press, released in place: it opens')
await page.keyboard.press('Escape'); await sleep(150)
await re(() => window.__re.store.getState().setSketchTool('select')); await sleep(150)

await page.screenshot({ path: shotPath('menu-4.png') })
writeFileSync(shotPath('piece-menu.json'), JSON.stringify({ ids, ...log }, null, 2))
await finish(browser, consoleErrors)
