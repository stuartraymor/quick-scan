// SPDX-License-Identifier: AGPL-3.0-only
// An overdefined sketch, as QUICKSURFACE 8.0.128 shows one (read live
// 2026-11-21): a dimension typed against another stays, its number turns
// yellow, the sketch says it is overdefined, and "Select overdefining
// constraints" asks "N constraints overdefine the sketch. Do you want to
// delete them?" — Yes deletes them, No leaves everything. By mouse and
// keyboard on the rendered controls.
import { writeFileSync } from 'node:fs'
import { check, click, finish, launchApp, loadScan, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { openReverse, reverseHelpers } from './lib.mjs'

const fixture = shotPath('overdefined-cylinder-r10.obj'), n = 96, obj = []
for (const z of [-5, 5]) for (let i = 0; i < n; i++) obj.push(`v ${10 * Math.cos(i * Math.PI * 2 / n)} ${10 * Math.sin(i * Math.PI * 2 / n)} ${z}`)
obj.push('v 0 0 -5', 'v 0 0 5')
for (let i = 0; i < n; i++) { const a = i + 1, b = (i + 1) % n + 1, c = a + n, d = b + n; obj.push(`f ${a} ${b} ${d}`, `f ${a} ${d} ${c}`, `f ${2 * n + 1} ${b} ${a}`, `f ${2 * n + 2} ${c} ${d}`) }
writeFileSync(fixture, obj.join('\n'))

const { browser, page, consoleErrors } = await launchApp({ width: 1500, height: 960, protocolTimeout: 600_000 })
const { re } = reverseHelpers(page)
const at = (point) => re((p) => window.__re.sheet().sheetScreenPoint(p), point)
const pointClick = async (p) => { const pixel = await at(p); await page.mouse.move(pixel.x, pixel.y); await sleep(80); await page.mouse.click(pixel.x, pixel.y); await sleep(150) }
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol
const typeInto = async (selector, text) => { await page.waitForSelector(selector); await page.focus(selector); await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await page.keyboard.type(text); await page.keyboard.press('Enter'); await sleep(400) }
const state = () => re(() => {
  const d = window.__re.store.getState().sketchDraft
  const line = d.sketch.entities.find((e) => e.kind === 'line')
  return { a: line.a, b: line.b, dims: d.sketch.constraints.filter((c) => 'value' in c).map((c) => ({ id: c.id, kind: c.kind, value: c.value })), ok: d.report?.ok, unmet: d.report?.unmet.map((u) => u.id) ?? [], selected: d.selectedConstraint }
})
const onScreen = (selector) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.width > 0 && !!top && (el === top || el.contains(top)) }, selector)
const yellow = () => page.$$eval('.viewport-label.sketch-dim.overdefined .label-value', (els) => els.map((el) => ({ text: el.textContent.trim(), bg: getComputedStyle(el).backgroundColor })))
try {
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

  // A sloped line with its length given, then its ends given a horizontal
  // and a vertical distance: three numbers for two freedoms.
  await click(page, '[data-test=sketch-tool-line]'); await pointClick([-4, -3]); await pointClick([4, 3]); await click(page, '[data-test=sketch-tool-select]')
  await click(page, '[data-test=sketch-dimension]')
  await pointClick([0.5, 0.375]); await pointClick([-3, 3])
  let s = await state()
  const lengthId = s.dims.find((d) => d.kind === 'length')?.id
  await typeInto(`[data-test="flat-dimension-${lengthId}"] input`, '10')
  await pointClick([-4, -3]); await pointClick([4, 3]); await pointClick([0, -6])
  s = await state()
  const dxId = s.dims.find((d) => d.kind === 'distance')?.id
  await typeInto(`[data-test="flat-dimension-${dxId}"] input`, '8')
  await pointClick([-4, -3]); await pointClick([4, 3]); await pointClick([7, 0])
  s = await state()
  const dyId = s.dims.filter((d) => d.kind === 'distance').at(-1)?.id
  check(s.ok && s.dims.length === 3 && dyId !== dxId, `length 10, horizontal 8 and the vertical 6 they make all hold (${JSON.stringify(s.dims)})`)
  check(!(await page.$eval('[data-test=sketch-overdefined]', (el) => el.disabled)) === false, 'Select overdefining constraints is greyed while the sketch solves')
  const before = await state()

  // The contradiction: the vertical typed to 9.
  await typeInto(`[data-test="flat-dimension-${dyId}"] input`, '9')
  s = await state()
  check(!s.ok && s.dims.find((d) => d.id === dyId)?.value === 9, `typing 9 is kept and the sketch no longer solves (unmet ${JSON.stringify(s.unmet)})`)
  check(/overdefined/i.test(await page.$eval('[data-test=sketch-status]', (el) => el.textContent)), 'the status reads "The sketch is overdefined"')
  check(await onScreen('[data-test=sketch-hint]') && /^The sketch is overdefined/.test(await page.$eval('[data-test=sketch-hint]', (el) => el.textContent.trim())), 'and the panel says so on screen, in the line above the status')
  const marks = await yellow()
  check(marks.length === 1 && marks[0].text === '9' && marks[0].bg === 'rgb(255, 230, 0)', `the 9 alone is yellow on the sheet (${JSON.stringify(marks)})`)
  await page.screenshot({ path: shotPath('01-overdefined.png') })
  check(!(await page.$eval('[data-test=sketch-overdefined]', (el) => el.disabled)), 'Select overdefining constraints is offered')

  await click(page, '[data-test=sketch-overdefined]'); await sleep(600)
  const ask = await page.$eval('[data-test=sketch-overdefined-ask] p', (el) => el.textContent)
  check(ask === '1 constraint overdefines the sketch. Do you want to delete it?', `it asks: "${ask}"`)
  check(await onScreen('[data-test=sketch-overdefined-yes]'), 'Yes and No are on screen')
  check((await state()).selected === dyId, 'the newest dimension, the 9, is the one selected')
  await page.screenshot({ path: shotPath('02-ask.png') })
  await click(page, '[data-test=sketch-overdefined-no]'); await sleep(200)
  s = await state()
  check(!s.ok && s.dims.length === 3 && !(await page.$('[data-test=sketch-overdefined-ask]')), 'No leaves the three dimensions and closes the question')

  await click(page, '[data-test=sketch-overdefined]'); await sleep(600)
  await click(page, '[data-test=sketch-overdefined-yes]'); await sleep(400)
  s = await state()
  check(s.ok && s.dims.length === 2 && !s.dims.some((d) => d.id === dyId), `Yes deletes the 9 and the sketch solves (${JSON.stringify(s.dims)})`)
  check(near(Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]), 10, 1e-4) && near(Math.abs(s.b[0] - s.a[0]), 8, 1e-4), 'the length 10 and the horizontal 8 hold')
  check((await yellow()).length === 0 && /Solved/.test(await page.$eval('[data-test=sketch-status]', (el) => el.textContent)), 'no yellow number is left and the status reads Solved')
  check(await page.$eval('[data-test=sketch-overdefined]', (el) => el.disabled), 'the key is greyed again')
  await page.screenshot({ path: shotPath('03-deleted.png') })

  await click(page, '[data-test=sketch-tool-select]')
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control'); await sleep(300)
  s = await state()
  check(!s.ok && s.dims.length === 3, 'one Undo brings the deleted dimension back, overdefined as it was')
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control'); await sleep(300)
  s = await state()
  check(s.ok && s.dims.length === 3 && near(s.a[0], before.a[0], 1e-9) && near(s.b[1], before.b[1], 1e-9), 'a second Undo returns the sketch as it stood before the 9, to the last digit')
  writeFileSync(shotPath('overdefined-results.json'), JSON.stringify({ before, final: s }, null, 2))
} catch (error) { check(false, error.stack ?? error.message) }
await finish(browser, consoleErrors)
