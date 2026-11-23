// SPDX-License-Identifier: AGPL-3.0-only
// 1.2.25: driven (reference) dimensions and an arc's length, by mouse and
// keyboard on the rendered controls. A dimension's Driving/Driven key makes it
// read the sketch, in brackets, holding nothing; one that overdefines the
// sketch keeps QUICKSURFACE's yellow and offers "Make driven"; an arc's
// dimension row can give the arc by its radius, its diameter or its length.
//
// Prereqs: dev server running (npm run dev), Chrome installed.
//   node plugins/reverse/scripts/e2e-sketch-driven.mjs
// Env: CHROME (chrome.exe path), APP_URL, SHOT_DIR.
import { writeFileSync } from 'node:fs'
import { check, click, finish, launchApp, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { reverseHelpers } from './lib.mjs'

const { browser, page, consoleErrors } = await launchApp({ width: 1600, height: 1000, protocolTimeout: 600_000 })
const { re } = reverseHelpers(page)
const row = (id) => `[data-test=sketch-dimension-row][data-constraint="${id}"]`
const typeInto = async (selector, text) => {
  await page.waitForSelector(selector)
  await page.focus(selector)
  await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control')
  await page.keyboard.type(text); await page.keyboard.press('Enter'); await sleep(400)
}
const state = () => re(() => {
  const d = window.__re.store.getState().sketchDraft
  const line = d.sketch.entities.find((e) => e.kind === 'line')
  const arc = d.sketch.entities.find((e) => e.kind === 'arc')
  return {
    length: Math.hypot(line.b[0] - line.a[0], line.b[1] - line.a[1]),
    arc: { r: arc.r, sweep: arc.sweep, c: arc.c },
    dims: d.sketch.constraints.filter((c) => 'value' in c).map((c) => ({ id: c.id, kind: c.kind, value: c.value, driven: c.driven === true, expr: c.expr ?? null })),
    ok: d.report?.ok, unmet: d.report?.unmet.map((u) => u.id) ?? [], error: d.error,
  }
})
const dimOf = (s, id) => s.dims.find((d) => d.id === id)
const labelOf = (id) => page.$eval(`[data-test=flat-dimension-${id}]`, (el) => {
  const v = el.querySelector('.label-value')
  const box = el.closest('.viewport-label') ?? el
  return { text: (v ?? el).textContent.trim(), className: box.className }
})
const near = (a, b, tol = 1e-4) => Math.abs(a - b) <= tol
const log = {}

await page.click('[data-test=workspace-reverse]')
await page.waitForSelector('[data-test=kernel-status]')
await sleep(300)

// A line along the sheet's x and a quarter arc off to the side, each given a
// number: the line's length, the arc's radius.
const ids = await re(() => {
  const s = () => window.__re.store.getState()
  const frame = { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }
  s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, frame, [
    { kind: 'line', a: [0, 0], b: [40, 0] },
    { kind: 'arc', c: [0, 30], r: 10, start: 0, sweep: Math.PI / 2 },
  ])
  const [line, arc] = s().sketchDraft.sketch.entities
  const dimension = (kind, entity) => {
    window.__re.store.setState((st) => ({ sketchDraft: { ...st.sketchDraft, selection: [entity] } }))
    s().addDimension(kind)
    return s().sketchDraft.sketch.constraints.filter((c) => 'value' in c).at(-1).id
  }
  window.__re.store.setState((st) => ({ sketchDraft: { ...st.sketchDraft, selection: [line.id] } }))
  s().addRelation('horizontal')
  const len = dimension('length', line.id)
  const rad = dimension('radius', arc.id)
  window.__re.store.setState((st) => ({ sketchDraft: { ...st.sketchDraft, selection: [], dimMade: null } }))
  s().setSketchTool('select')
  return { line: line.id, arc: arc.id, len, rad }
})
await sleep(600)
await re(() => document.activeElement?.blur?.())
let s = await state()
check(s.ok && dimOf(s, ids.len)?.value === 40 && !dimOf(s, ids.len).driven, `a length of 40 and a radius of 10, both driving (${JSON.stringify(s.dims)})`)
check((await page.$eval(`${row(ids.len)} [data-test=sketch-dimension-driven]`, (b) => b.textContent.trim())) === 'Driving', 'each dimension row has a Driving key')

// ---- made driven: brackets, read only ------------------------------------------------------
await click(page, `${row(ids.len)} [data-test=sketch-dimension-driven]`)
await sleep(400)
s = await state()
check(dimOf(s, ids.len).driven && s.ok, `pressed, the length is driven and the sketch still solves (${JSON.stringify(dimOf(s, ids.len))})`)
check(await page.$eval(`${row(ids.len)} [data-test=sketch-dimension-driven]`, (b) => b.getAttribute('aria-pressed') === 'true' && b.textContent.trim() === 'Driven'), 'the key reads Driven, pressed')
check((await page.$(`${row(ids.len)} [data-test=sketch-dimension-input]`)) === null, 'a driven row has no field to type in')
const read1 = await page.$eval(`${row(ids.len)} [data-test=sketch-dimension-read]`, (el) => el.textContent.trim())
check(/^\(40(\.0+)?( ?mm)?\)$/.test(read1), `it shows its value in brackets instead (${read1})`)
let label = await labelOf(ids.len)
check(label.text === '(40)', `on the sheet its number is in brackets (${label.text})`)
check(/\bdriven\b/.test(label.className), `and drawn as a reference (${label.className})`)
log.driven = { read1, label }
await page.screenshot({ path: shotPath('driven-1.png') })

// ---- a driving length beside it moves the line; the driven one follows --------------------
const second = await re((line) => {
  const s = () => window.__re.store.getState()
  window.__re.store.setState((st) => ({ sketchDraft: { ...st.sketchDraft, selection: [line] } }))
  s().addDimension('length')
  window.__re.store.setState((st) => ({ sketchDraft: { ...st.sketchDraft, selection: [], dimMade: null } }))
  return s().sketchDraft.sketch.constraints.filter((c) => 'value' in c).at(-1).id
}, ids.line)
await sleep(400)
await typeInto(`${row(second)} [data-test=sketch-dimension-input]`, '25')
s = await state()
check(s.ok && near(s.length, 25, 1e-6), `a second length typed 25 sets the line (${s.length}) with no conflict`)
check(near(dimOf(s, ids.len).value, 25, 1e-6), `the driven one now reads 25 (${dimOf(s, ids.len).value})`)
label = await labelOf(ids.len)
check(label.text === '(25)', `and the sheet writes (25) (${label.text})`)

// ---- a fighting dimension: yellow, and "Make driven" settles it -----------------------------
await click(page, `${row(ids.len)} [data-test=sketch-dimension-driven]`)
await sleep(300)
s = await state()
check(!dimOf(s, ids.len).driven && near(dimOf(s, ids.len).value, 25, 1e-6), `pressed again it drives, at what it read (${JSON.stringify(dimOf(s, ids.len))})`)
await typeInto(`${row(ids.len)} [data-test=sketch-dimension-input]`, '30')
s = await state()
check(!s.ok && dimOf(s, ids.len).value === 30, `typing 30 against the 25 overdefines the sketch, and the 30 stays (unmet ${JSON.stringify(s.unmet)})`)
const yellow = await page.$$eval('.viewport-label.sketch-dim.overdefined .label-value', (els) => els.map((el) => el.textContent.trim()))
check(yellow.length >= 1, `the fighting number is yellow on the sheet (${JSON.stringify(yellow)})`)
const offers = await page.$$eval('[data-test=sketch-dimension-make-driven]', (els) => els.map((el) => el.closest('[data-test=sketch-dimension-row]').dataset.constraint))
check(offers.length >= 1, `its row offers Make driven (${JSON.stringify(offers)})`)
await page.screenshot({ path: shotPath('driven-2-overdefined.png') })
const chosen = Number(offers[0])
await click(page, `${row(chosen)} [data-test=sketch-dimension-make-driven]`)
await sleep(400)
s = await state()
const kept = [ids.len, second].find((id) => id !== chosen)
check(s.ok && dimOf(s, chosen).driven, `Make driven settles the sketch (${JSON.stringify(s.dims)})`)
check(near(s.length, dimOf(s, kept).value, 1e-6) && near(dimOf(s, chosen).value, s.length, 1e-6), `the line follows the driving one (${dimOf(s, kept).value}), the driven one reads it (${dimOf(s, chosen).value})`)
check((await page.$$('.viewport-label.sketch-dim.overdefined')).length === 0, 'nothing is yellow now')
check((await page.$('[data-test=sketch-dimension-make-driven]')) === null, 'and no row offers Make driven')
log.fight = { offers, chosen, kept, dims: s.dims }

// ---- an arc's length -------------------------------------------------------------------
check(await page.$eval(`${row(ids.rad)} [data-test=sketch-dimension-arc-form]`, (el) => el.value) === 'radius', "the arc's row gives it by its radius")
await page.select(`${row(ids.rad)} [data-test=sketch-dimension-arc-form]`, 'arcLength')
await sleep(400)
s = await state()
let arcDim = dimOf(s, ids.rad)
check(arcDim.kind === 'arcLength' && near(arcDim.value, 5 * Math.PI, 1e-6), `chosen Arc length, it reads 5π (${arcDim.value})`)
check(near(s.arc.r, 10, 1e-6) && near(Math.abs(s.arc.sweep), Math.PI / 2, 1e-6), 'and the arc has not moved')
label = await labelOf(ids.rad)
check(label.text === '⌒ 15.708', `the sheet writes ⌒ 15.708 (${label.text})`)
await typeInto(`${row(ids.rad)} [data-test=sketch-dimension-input]`, '20')
s = await state()
check(s.ok && near(Math.abs(s.arc.r * s.arc.sweep), 20, 1e-5), `typed 20, the arc is 20 long round its rim (r ${s.arc.r}, sweep ${s.arc.sweep})`)
label = await labelOf(ids.rad)
check(label.text === '⌒ 20', `and the sheet writes ⌒ 20 (${label.text})`)
await page.screenshot({ path: shotPath('driven-3-arc-length.png') })

await click(page, `${row(ids.rad)} [data-test=sketch-dimension-driven]`)
await sleep(300)
label = await labelOf(ids.rad)
check(label.text === '(⌒ 20)', `driven, the arc length is bracketed (${label.text})`)
await re(() => document.activeElement?.blur?.())
await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control')
await sleep(400)
s = await state()
arcDim = dimOf(s, ids.rad)
check(arcDim.kind === 'arcLength' && !arcDim.driven && near(arcDim.value, 20, 1e-9), `Ctrl+Z makes it driving again at 20 (${JSON.stringify(arcDim)})`)
label = await labelOf(ids.rad)
check(label.text === '⌒ 20', `and takes the brackets off (${label.text})`)

await page.select(`${row(ids.rad)} [data-test=sketch-dimension-arc-form]`, 'radius')
await sleep(300)
s = await state()
arcDim = dimOf(s, ids.rad)
check(arcDim.kind === 'radius' && near(arcDim.value, s.arc.r, 1e-9) && near(Math.abs(s.arc.r * s.arc.sweep), 20, 1e-5), `back to Radius, it reads the arc as it stands (R ${arcDim.value})`)
log.arc = { arc: s.arc, dims: s.dims }

await page.screenshot({ path: shotPath('driven-4.png') })
writeFileSync(shotPath('driven.json'), JSON.stringify(log, null, 2))
await finish(browser, consoleErrors)
