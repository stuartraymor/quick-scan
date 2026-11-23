// SPDX-License-Identifier: AGPL-3.0-only
// The Dimension tool between two points, as QUICKSURFACE 8.0.128 gives it
// (read live 2026-11-21): with the two points picked, the number in hand is
// the horizontal distance while the cursor is above or below the pair, the
// vertical one beside it, and the straight one anywhere else; the click puts
// that one down. Every step is by mouse and keyboard on the rendered sheet.
import { writeFileSync } from 'node:fs'
import { check, click, finish, launchApp, loadScan, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { openReverse, reverseHelpers } from './lib.mjs'

const fixture = shotPath('dim-axis-cylinder-r10.obj'), n = 96, obj = []
for (const z of [-5, 5]) for (let i = 0; i < n; i++) obj.push(`v ${10 * Math.cos(i * Math.PI * 2 / n)} ${10 * Math.sin(i * Math.PI * 2 / n)} ${z}`)
obj.push('v 0 0 -5', 'v 0 0 5')
for (let i = 0; i < n; i++) { const a = i + 1, b = (i + 1) % n + 1, c = a + n, d = b + n; obj.push(`f ${a} ${b} ${d}`, `f ${a} ${d} ${c}`, `f ${2 * n + 1} ${b} ${a}`, `f ${2 * n + 2} ${c} ${d}`) }
writeFileSync(fixture, obj.join('\n'))

const { browser, page, consoleErrors } = await launchApp({ width: 1500, height: 960, protocolTimeout: 600_000 })
const { re } = reverseHelpers(page)
const at = (point) => re((p) => window.__re.sheet().sheetScreenPoint(p), point)
const pointClick = async (p) => { const pixel = await at(p); await page.mouse.move(pixel.x, pixel.y); await sleep(80); await page.mouse.click(pixel.x, pixel.y); await sleep(150) }
const hover = async (p) => { const pixel = await at(p); await page.mouse.move(pixel.x, pixel.y); await sleep(200) }
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol
const state = () => re(() => {
  const d = window.__re.store.getState().sketchDraft
  const line = d.sketch.entities.find((e) => e.kind === 'line')
  const dims = d.sketch.constraints.filter((c) => c.kind === 'distance')
  return { a: line.a, b: line.b, dims, made: d.dimMade, ok: d.report?.ok, unmet: d.report?.unmet.length, history: d.history.length }
})
/** The numbers written on the sheet, as text. */
const labels = () => page.$$eval('.viewport-label.sketch-dim', (els) => els.map((el) => el.textContent.trim()))
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

  // A sloped line, drawn by two clicks.
  await click(page, '[data-test=sketch-tool-line]'); await pointClick([-4, -2]); await pointClick([4, 2]); await click(page, '[data-test=sketch-tool-select]')
  const drawn = await state()
  check(near(drawn.a[0], -4, 1e-3) && near(drawn.b[1], 2, 1e-3) && drawn.dims.length === 0, `a sloped line is drawn (${JSON.stringify([drawn.a, drawn.b])})`)

  // Dimension: the two ends picked, then the cursor moved about.
  await click(page, '[data-test=sketch-dimension]')
  await pointClick([-4, -2]); await pointClick([4, 2])
  const held = await state()
  check(held.made != null && held.dims.length === 1, 'two end clicks put a distance in hand')
  const straight = Math.hypot(8, 4)
  await hover([0, -6]); const below = await labels()
  check(below.some((t) => /^8(\.0+)?\b/.test(t)), `cursor below the pair: the horizontal distance, 8 (${JSON.stringify(below)})`)
  await page.screenshot({ path: shotPath('01-held-horizontal.png') })
  await hover([7, 0]); const beside = await labels()
  check(beside.some((t) => /^4(\.0+)?\b/.test(t)), `cursor beside the pair: the vertical distance, 4 (${JSON.stringify(beside)})`)
  await page.screenshot({ path: shotPath('02-held-vertical.png') })
  await hover([-1, 1.5]); const between = await labels()
  check(between.some((t) => t.startsWith('8.944')), `cursor between the points: the straight distance, 8.944 (${JSON.stringify(between)})`)
  await page.screenshot({ path: shotPath('03-held-aligned.png') })
  const stillHeld = await state()
  check(stillHeld.dims[0].axis === undefined && near(stillHeld.dims[0].value, straight, 1e-4) && near(stillHeld.a[0], drawn.a[0]) && near(stillHeld.b[1], drawn.b[1]), 'moving the cursor changes nothing in the sketch')

  // Put down below: horizontal, opened for typing.
  await pointClick([0, -6])
  const placed = await state()
  check(placed.made == null && placed.dims[0].axis === 'x' && near(placed.dims[0].value, 8, 1e-4), `the click below puts down the horizontal distance (${JSON.stringify(placed.dims[0])})`)
  const input = `[data-test="flat-dimension-${placed.dims[0].id}"] input`
  await page.waitForSelector(input)
  await page.focus(input); await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await page.keyboard.type('10'); await page.keyboard.press('Enter'); await sleep(400)
  const typed = await state()
  check(typed.ok && near(Math.abs(typed.b[0] - typed.a[0]), 10, 1e-6) && near(typed.dims[0].value, 10), `typing 10 makes the ends 10 apart in X and the sketch solves (${JSON.stringify([typed.a, typed.b])})`)
  check(!near(Math.hypot(typed.b[0] - typed.a[0], typed.b[1] - typed.a[1]), 10, 1e-3), 'the straight length is not what was driven')
  const drawnLabel = await labels()
  check(drawnLabel.some((t) => /^10\b/.test(t)), `the sheet shows 10 (${JSON.stringify(drawnLabel)})`)
  await page.screenshot({ path: shotPath('04-horizontal-10.png') })

  // The row's switch: Horizontal → Vertical keeps the pieces and re-reads.
  const axisSelect = '[data-test=sketch-dimension-axis]'
  check(await page.$eval(axisSelect, (el) => el.value) === 'x', 'the dimension row reads Horizontal')
  await page.select(axisSelect, 'y'); await sleep(300)
  const vertical = await state()
  check(vertical.dims[0].axis === 'y' && near(vertical.dims[0].value, Math.abs(typed.b[1] - typed.a[1]), 1e-9) && near(vertical.a[0], typed.a[0], 1e-9) && near(vertical.b[1], typed.b[1], 1e-9), `Vertical re-reads the same pieces (${vertical.dims[0].value})`)
  await page.select(axisSelect, 'aligned'); await sleep(300)
  const aligned = await state()
  check(aligned.dims[0].axis === undefined && near(aligned.dims[0].value, Math.hypot(typed.b[0] - typed.a[0], typed.b[1] - typed.a[1]), 1e-9), `Aligned is the straight distance (${aligned.dims[0].value})`)

  // Undo walks back: aligned → vertical → horizontal 10 → horizontal 8 → none.
  await click(page, '[data-test=sketch-tool-select]')
  const undo = async () => { await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control'); await sleep(250) }
  await undo(); await undo()
  const back = await state()
  check(back.dims[0]?.axis === 'x' && near(back.dims[0].value, 10) && near(Math.abs(back.b[0] - back.a[0]), 10, 1e-6), 'two Undos return to the horizontal 10')
  await undo()
  const back8 = await state()
  check(back8.dims[0]?.axis === 'x' && near(back8.dims[0].value, 8, 1e-4) && near(back8.a[0], drawn.a[0], 1e-6) && near(back8.b[0], drawn.b[0], 1e-6), 'a third returns the line to where it was drawn')
  await undo()
  check((await state()).dims.length === 0, 'a fourth takes the dimension away')

  // A level pair has one distance only: nothing switches.
  await click(page, '[data-test=sketch-tool-line]'); await pointClick([-6, 6]); await pointClick([6, 6]); await click(page, '[data-test=sketch-tool-select]')
  await click(page, '[data-test=sketch-dimension]'); await pointClick([-6, 6]); await pointClick([6, 6]); await hover([0, 8])
  const level = await state()
  check(level.dims.length === 1 && level.dims[0].axis === undefined, 'two level points give the plain distance wherever the cursor is')
  writeFileSync(shotPath('dim-axis-results.json'), JSON.stringify({ drawn, placed, typed, vertical, aligned }, null, 2))
} catch (error) { check(false, error.stack ?? error.message) }
await finish(browser, consoleErrors)
