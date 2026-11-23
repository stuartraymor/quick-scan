// SPDX-License-Identifier: AGPL-3.0-only
// 1.2.23, by mouse: Analysis → Measure's Sketch way (which brings the CAD
// workspace forward), on the open sketch's
// sheet and on the part once the sketch is finished (the brief's Part 14,
// M01–M05, M09, and centre to origin). Circle A about (−7, 4), r 3; circle B
// about (8, 6), r 1.5. Every check reads the dialog's results (their
// full-precision values in data attributes) and the stored sketch, which
// must not change.
import { writeFileSync } from 'node:fs'
import { check, click, finish, launchApp, loadScan, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { openReverse, reverseHelpers } from './lib.mjs'

const fixture = shotPath('measure-sketch-cylinder.obj'), n = 96, obj = []
for (const z of [-5, 5]) for (let i = 0; i < n; i++) obj.push(`v ${10 * Math.cos(i * Math.PI * 2 / n)} ${10 * Math.sin(i * Math.PI * 2 / n)} ${z}`)
obj.push('v 0 0 -5', 'v 0 0 5')
for (let i = 0; i < n; i++) { const a = i + 1, b = (i + 1) % n + 1, c = a + n, d = b + n; obj.push(`f ${a} ${b} ${d}`, `f ${a} ${d} ${c}`, `f ${2 * n + 1} ${b} ${a}`, `f ${2 * n + 2} ${c} ${d}`) }
writeFileSync(fixture, obj.join('\n'))

const { browser, page, consoleErrors } = await launchApp({ width: 1500, height: 960, protocolTimeout: 600_000 })
const { re } = reverseHelpers(page)
const onSheet = (p) => re((q) => window.__re.sheet().sheetScreenPoint(q), p)
const onPart = (p) => re((q) => window.__re.scene().screenPointOf(q), p)
/** A click on the view at a pixel — on the canvas there, not on the dialog. */
const clickAt = async (pixel) => {
  const onCanvas = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName === 'CANVAS', pixel)
  if (!onCanvas) throw new Error(`the click at ${JSON.stringify(pixel)} would not land on the view`)
  await page.mouse.move(pixel.x, pixel.y); await sleep(100); await page.mouse.click(pixel.x, pixel.y); await sleep(300)
}
const sketchNow = () => re(() => { const s = window.__re.store.getState(); return JSON.stringify(s.sketchDraft?.sketch ?? s.features.find((f) => f.kind === 'sketch')?.sketch) })
/** The newest readout in the dialog: its title and its rows by label. */
const newest = () => page.evaluate(() => {
  const box = document.querySelector('[data-test=measure-readout]')
  if (!box) return null
  const rows = {}
  for (const r of box.querySelectorAll('[data-test=measure-row]')) rows[r.dataset.label] = { value: Number(r.dataset.value), text: r.lastElementChild.textContent, exact: r.dataset.exact === 'true', point: r.dataset.value }
  return { title: box.querySelector('b').textContent, rows, count: document.querySelectorAll('[data-test=measure-readout]').length }
})
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol
const clearAll = async () => { await click(page, '[data-test=measure-delete-all]').catch(() => {}); await sleep(200) }
const R = 3, r = 1.5, A = [-7, 4], B = [8, 6]
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
  // Two circles, typed exact afterwards so the expected figures are round.
  await click(page, '[data-test=sketch-tool-circle]')
  await clickAt(await onSheet(A)); await clickAt(await onSheet([A[0] + 2.9, A[1] + 0.4]))
  await clickAt(await onSheet(B)); await clickAt(await onSheet([B[0] + 1.4, B[1] + 0.3]))
  await click(page, '[data-test=sketch-tool-select]'); await page.keyboard.press('Escape'); await sleep(200)
  await re(([a, ra, b, rb]) => window.__re.store.setState((s) => {
    const [ca, cb] = s.sketchDraft.sketch.entities.filter((e) => e.kind === 'circle')
    const entities = s.sketchDraft.sketch.entities.map((e) => (e.id === ca.id ? { ...e, c: a, r: ra } : e.id === cb.id ? { ...e, c: b, r: rb } : e))
    return { sketchDraft: { ...s.sketchDraft, sketch: { ...s.sketchDraft.sketch, entities } } }
  }), [A, R, B, r])
  await sleep(400)
  const circles = JSON.parse(await sketchNow()).entities.filter((e) => e.kind === 'circle')
  check(circles.length === 2 && circles[0].r === R && circles[1].r === r, `two circles on the sheet (${JSON.stringify(circles.map((c) => [c.c, c.r]))})`)
  const before = await sketchNow()

  // ---- Analysis → Measure → Sketch ----------------------------------------------
  // The Analysis tab brings the Compare workspace forward, where no sketch is
  // drawn; the Sketch way brings the CAD workspace back, the sketch open.
  await page.evaluate(() => [...document.querySelectorAll('button, [role=tab]')].find((b) => b.textContent.trim() === 'Analysis')?.click())
  await sleep(400)
  await click(page, '[data-test=ribbon-measure]')
  await page.waitForSelector('[data-test=measure-dialog]')
  const key = await page.$eval('[data-test=measure-plugin-sketch]', (el) => ({ disabled: el.disabled, title: el.title }))
  check(!key.disabled && /sketch/i.test(key.title), `Analysis → Measure offers the Sketch way (${JSON.stringify(key)})`)
  await click(page, '[data-test=measure-plugin-sketch]'); await page.waitForSelector('[data-test=sketch-editor]'); await sleep(600)
  const where = await re(() => ({ draft: window.__re.store.getState().sketchDraft !== null, sheet: Boolean(window.__re.sheet()) }))
  check(where.draft && where.sheet && (await page.$eval('[data-test=measure-plugin-sketch]', (el) => el.getAttribute('aria-pressed') === 'true')), `the Sketch way chosen brings the open sketch back on screen (${JSON.stringify(where)})`)
  // The dialog taken by its title to the left edge, over the Objects panel, off the circles.
  const head = await page.$eval('[data-test=measure-dialog] header', (el) => { const r = el.getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 } })
  await page.mouse.move(head.x, head.y); await page.mouse.down(); await page.mouse.move(head.x - 265, head.y + 20, { steps: 8 }); await page.mouse.up(); await sleep(200)

  // M01 / 14.8: a click on A's rim, away from its squares.
  await clickAt(await onSheet([A[0] + R * Math.cos(0.6), A[1] + R * Math.sin(0.6)]))
  let o = await newest()
  check(o && /circle/.test(o.title), `a click on the rim reads the circle (${o?.title})`)
  check(o && near(o.rows['Radius']?.value, R, 1e-12) && near(o.rows['Diameter']?.value, 2 * R, 1e-12) && near(o.rows['Circumference']?.value, 2 * Math.PI * R, 1e-9), `radius 3, diameter 6, circumference 6π, exact (${JSON.stringify(o?.rows && [o.rows['Radius']?.text, o.rows['Diameter']?.text, o.rows['Circumference']?.text])})`)
  check(o && o.rows['Centre']?.point === `${A[0]},${A[1]}`, `and its centre at (−7, 4) (${o?.rows['Centre']?.point})`)
  const label = await page.evaluate(() => [...document.querySelectorAll('.measure-label')].map((el) => el.textContent))
  check(label.some((t) => /^R 3\.0000/.test(t)), `the radius boxed over the sheet (${JSON.stringify(label)})`)
  await page.screenshot({ path: shotPath('01-sheet-circle.png') })
  await clearAll()

  // M03: right then top quadrant squares of A.
  await clickAt(await onSheet([A[0] + R, A[1]]))
  await clickAt(await onSheet([A[0], A[1] + R]))
  o = await newest()
  check(o && /quadrant/.test(o.title), `two quadrant squares are two points (${o?.title}; ${o?.count} readouts: ${await page.evaluate(() => [...document.querySelectorAll('[data-test=measure-readout] b')].map((b) => b.textContent).join(' | '))})`)
  check(o && near(o.rows['Chord (straight line between the two points)']?.value, R * Math.SQRT2, 1e-9) && near(o.rows['Central angle (short way)']?.value, 90, 1e-9) && near(o.rows['Arc length, short way round']?.value, R * Math.PI / 2, 1e-9) && near(o.rows['Arc length, long way round']?.value, R * Math.PI * 1.5, 1e-9),
    `chord 3√2, 90°, short arc 1.5π, long arc 4.5π (${JSON.stringify(o?.rows && Object.fromEntries(Object.entries(o.rows).map(([k, v]) => [k, v.text])))})`)
  await page.screenshot({ path: shotPath('02-sheet-quadrants.png') })
  await clearAll()

  // M09: centre to centre.
  await clickAt(await onSheet(A)); await clickAt(await onSheet(B))
  o = await newest()
  check(o && near(o.rows['Centre-to-centre distance']?.value, Math.hypot(15, 2), 1e-9) && near(o.rows['ΔX (sketch X)']?.value, 15, 1e-9) && near(o.rows['ΔY (sketch Y)']?.value, 2, 1e-9), `A's centre to B's: √229, ΔX 15, ΔY 2 (${o?.title}: ${JSON.stringify(o?.rows && Object.fromEntries(Object.entries(o.rows).map(([k, v]) => [k, v.text])))})`)
  await clearAll()

  // Centre to origin.
  await clickAt(await onSheet(B)); await clickAt(await onSheet([0, 0]))
  o = await newest()
  check(o && /origin/.test(o.title) && near(o.rows['Straight-line distance']?.value, 10, 1e-9), `B's centre to the origin: 10 (${o?.title}: ${o?.rows['Straight-line distance']?.text})`)
  // Read only: nothing selected by the clicks, and a press dragged across
  // circle A's rim moves nothing.
  const selected = await re(() => window.__re.store.getState().sketchDraft.selection)
  check(selected.length === 0, `the measuring clicks selected nothing in the sketch (${JSON.stringify(selected)})`)
  const grip = await onSheet([A[0] + R * Math.cos(2.2), A[1] + R * Math.sin(2.2)])
  await page.mouse.move(grip.x, grip.y); await page.mouse.down(); await page.mouse.move(grip.x + 60, grip.y + 40, { steps: 10 }); await page.mouse.up(); await sleep(300)
  check((await sketchNow()) === before, 'the sketch is unchanged by measuring it, a drag across a circle included')
  await clearAll()

  // ---- on the part, the sketch finished ----------------------------------------
  await click(page, '[data-test=sketch-finish]'); await sleep(1200)
  check(await re(() => !window.__re.store.getState().sketchDraft && window.__re.store.getState().features.some((f) => f.kind === 'sketch' && f.visible)), 'the sketch is finished and shown on the part')
  check(await page.$eval('[data-test=measure-plugin-sketch]', (el) => el.getAttribute('aria-pressed') === 'true').catch(() => false), 'the dialog stays open on its Sketch way after the sketch is finished')
  await sleep(300)
  await clickAt(await onPart([A[0] + R * Math.cos(0.6), A[1] + R * Math.sin(0.6), 0]))
  o = await newest()
  check(o && near(o.rows['Radius']?.value, R, 1e-12) && near(o.rows['Circumference']?.value, 2 * Math.PI * R, 1e-9), `on the part, a click on A's rim reads R 3 and C 6π (${o?.title}: ${o?.rows['Radius']?.text}, ${o?.rows['Circumference']?.text})`)
  await clearAll()
  await clickAt(await onPart([...A, 0])); await clickAt(await onPart([...B, 0]))
  o = await newest()
  check(o && near(o.rows['Centre-to-centre distance']?.value, Math.hypot(15, 2), 1e-9), `on the part, centre to centre √229 (${o?.title}: ${o?.rows['Centre-to-centre distance']?.text})`)
  const drawn = await page.evaluate(() => document.querySelectorAll('[data-test=measure-layer] polyline').length)
  check(drawn >= 1, `the distance is drawn over the view (${drawn} lines)`)
  await page.screenshot({ path: shotPath('03-part-centres.png') })
  const listed = (await newest()).count
  await click(page, '[data-test=measure-delete-last]'); await sleep(200)
  o = await newest()
  check((o?.count ?? 0) === listed - 1 && !/→/.test(o?.title ?? ''), `Delete Last takes the last readout away (${listed} → ${o?.count ?? 0}, newest now ${o?.title})`)
  check((await sketchNow()) === before, 'the finished sketch is unchanged by measuring it')
  await click(page, '[data-test=measure-close]'); await sleep(200)
} catch (error) { check(false, error.stack ?? error.message) }
await finish(browser, consoleErrors)
