// SPDX-License-Identifier: AGPL-3.0-only
// Trim keeps what it leaves joined (1.2.18): a rectangle's top side trimmed
// back to a line that crosses it stays level, stays joined to its corner,
// and its new end follows the line that cut it when that line is dragged.
// Also: a relation glyph in the way of a drawing tool's click does not take
// the click. By mouse and keyboard on the rendered sheet.
import { writeFileSync } from 'node:fs'
import { check, click, finish, launchApp, loadScan, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { openReverse, reverseHelpers } from './lib.mjs'

const fixture = shotPath('trim-cylinder-r10.obj'), n = 96, obj = []
for (const z of [-5, 5]) for (let i = 0; i < n; i++) obj.push(`v ${10 * Math.cos(i * Math.PI * 2 / n)} ${10 * Math.sin(i * Math.PI * 2 / n)} ${z}`)
obj.push('v 0 0 -5', 'v 0 0 5')
for (let i = 0; i < n; i++) { const a = i + 1, b = (i + 1) % n + 1, c = a + n, d = b + n; obj.push(`f ${a} ${b} ${d}`, `f ${a} ${d} ${c}`, `f ${2 * n + 1} ${b} ${a}`, `f ${2 * n + 2} ${c} ${d}`) }
writeFileSync(fixture, obj.join('\n'))

const { browser, page, consoleErrors } = await launchApp({ width: 1500, height: 960, protocolTimeout: 600_000 })
const { re } = reverseHelpers(page)
const at = (point) => re((p) => window.__re.sheet().sheetScreenPoint(p), point)
const pointClick = async (p) => { const pixel = await at(p); await page.mouse.move(pixel.x, pixel.y); await sleep(100); await page.mouse.click(pixel.x, pixel.y); await sleep(180) }
const read = () => re(() => { const d = window.__re.store.getState().sketchDraft; return { entities: d.sketch.entities, constraints: d.sketch.constraints, ok: d.report?.ok, regions: d.found.length, history: d.history.length, tool: d.tool, error: d.error } })
const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol
const undo = async () => { await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control'); await sleep(300) }
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

  // A rectangle, and a line begun right on the glyph of its top side.
  await click(page, '[data-test=sketch-tool-rectangle]'); await pointClick([-6, -4]); await pointClick([6, 3]); await click(page, '[data-test=sketch-tool-select]')
  let s = await read()
  check(s.entities.filter((e) => e.kind === 'line').length === 4 && s.regions === 1, 'a rectangle of four lines closes one region')
  await click(page, '[data-test=sketch-tool-line]')
  const glyph = await page.evaluate(() => {
    // A glyph of the rectangle that sits above its top side.
    const boxes = [...document.querySelectorAll('.viewport-label.note-label.glyph')].map((el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, events: getComputedStyle(el).pointerEvents } })
    return boxes.sort((a, b) => a.y - b.y)[0] ?? null
  })
  check(!!glyph && glyph.events === 'none', `with the Line tool in hand the glyphs take no clicks (${JSON.stringify(glyph)})`)
  const before = (await read()).entities.length
  await page.mouse.click(glyph.x, glyph.y); await sleep(150)
  await pointClick([2, 8])
  await click(page, '[data-test=sketch-tool-select]')
  s = await read()
  check(s.entities.length === before + 1, 'a line begun on a glyph is drawn: the click went to the tool')
  const glyphBack = await page.evaluate(() => getComputedStyle(document.querySelector('.viewport-label.note-label.glyph')).pointerEvents)
  check(glyphBack !== 'none', 'back on Modify the glyphs can be clicked again')
  await undo()
  check((await read()).entities.length === before, 'Undo takes that line away')

  // The cutter: a line across the top side at x = 2.
  await click(page, '[data-test=sketch-tool-line]'); await pointClick([2, 0.5]); await pointClick([2, 8]); await click(page, '[data-test=sketch-tool-select]')
  s = await read()
  const cutter = s.entities.at(-1)
  const top = s.entities.find((e) => e.kind === 'line' && e.id !== cutter.id && near(e.a[1], 3) && near(e.b[1], 3))
  check(!!top && cutter.kind === 'line' && near(cutter.a[0], 2), `the cutter crosses the top side (${JSON.stringify([cutter.a, cutter.b])})`)
  const steps = s.history

  // Trim the part of the top side to the right of the cutter.
  await click(page, '[data-test=sketch-trim]')
  const hoverPx = await at([4, 3]); await page.mouse.move(hoverPx.x, hoverPx.y); await sleep(300)
  await page.screenshot({ path: shotPath('01-trim-preview.png') })
  await page.mouse.click(hoverPx.x, hoverPx.y); await sleep(300)
  await click(page, '[data-test=sketch-tool-select]')
  s = await read()
  const kept = s.entities.find((e) => e.kind === 'line' && near(e.a[1], 3) && near(e.b[1], 3))
  const span = kept ? [kept.a[0], kept.b[0]].sort((a, b) => a - b) : []
  check(!!kept && near(span[0], -6) && near(span[1], 2) && s.history === steps + 1, `the right part is gone, the left part runs from the corner to the cutter, in one step (${JSON.stringify(span)})`)
  const mine = s.constraints.filter((c) => JSON.stringify(c).includes(`"entity":${kept.id}`) || c.a === kept.id || c.b === kept.id || c.entity === kept.id || c.line === kept.id)
  check(mine.some((c) => c.kind === 'coincident'), 'it is still joined to the corner it kept')
  check(mine.some((c) => c.kind === 'pointOn' && c.on.line === cutter.id), 'its new end is held on the cutter')
  check(mine.some((c) => ['horizontal', 'parallel', 'perpendicular'].includes(c.kind)), `it keeps its direction (${mine.map((c) => c.kind).join(', ')})`)
  check(s.ok, 'the sketch solves')
  await page.screenshot({ path: shotPath('02-trimmed.png') })

  // Drag the cutter by its body two millimetres left: the trimmed end follows.
  const from = await at([2, 6]), to = await at([0, 6])
  await page.mouse.move(from.x, from.y); await sleep(150); await page.mouse.down()
  for (let i = 1; i <= 10; i++) { await page.mouse.move(from.x + (to.x - from.x) * i / 10, from.y + (to.y - from.y) * i / 10); await sleep(30) }
  await page.mouse.up(); await sleep(400)
  s = await read()
  const movedCutter = s.entities.find((e) => e.id === cutter.id), movedKept = s.entities.find((e) => e.id === kept.id)
  const end = [movedKept.a, movedKept.b].sort((a, b) => a[0] - b[0])[1]
  check(near(movedCutter.a[0], 0, 0.3) && near(end[0], movedCutter.a[0], 1e-4) && near(end[1], 3, 1e-4) && near(Math.min(movedKept.a[0], movedKept.b[0]), -6, 1e-4), `dragging the cutter to x ≈ 0 carries the trimmed end with it, level, the corner where it was (cutter ${movedCutter.a[0].toFixed(3)}, end ${end[0].toFixed(3)})`)
  await page.screenshot({ path: shotPath('03-cutter-dragged.png') })

  // Undo the drag and the trim: the rectangle is whole and closed again.
  await undo(); await undo()
  s = await read()
  check(s.regions === 1 && s.entities.some((e) => e.id === top.id) && s.ok, 'two Undos give back the whole rectangle, closed')
  writeFileSync(shotPath('trim-keeps-results.json'), JSON.stringify({ mine, span }, null, 2))
} catch (error) { check(false, error.stack ?? error.message) }
await finish(browser, consoleErrors)
