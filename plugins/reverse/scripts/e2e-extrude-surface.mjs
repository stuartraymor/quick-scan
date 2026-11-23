// SPDX-License-Identifier: AGPL-3.0-only
// Extrude's Solid box, as QUICKSURFACE has it: an open profile extrudes as a
// surface (its "Wall (Surface)"), a closed one as a solid — or, with Solid
// unticked, as a surface too. Drawn, extruded and checked through the
// rendered controls; the bodies are read from the kernel's own results.
import { writeFileSync } from 'node:fs'
import { check, click, finish, launchApp, loadScan, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { openReverse, reverseHelpers } from './lib.mjs'

const fixture = shotPath('surface-cylinder-r10.obj'), n = 96, obj = []
for (const z of [-5, 5]) for (let i = 0; i < n; i++) obj.push(`v ${10 * Math.cos(i * Math.PI * 2 / n)} ${10 * Math.sin(i * Math.PI * 2 / n)} ${z}`)
obj.push('v 0 0 -5', 'v 0 0 5')
for (let i = 0; i < n; i++) { const a = i + 1, b = (i + 1) % n + 1, c = a + n, d = b + n; obj.push(`f ${a} ${b} ${d}`, `f ${a} ${d} ${c}`, `f ${2 * n + 1} ${b} ${a}`, `f ${2 * n + 2} ${c} ${d}`) }
writeFileSync(fixture, obj.join('\n'))

const { browser, page, consoleErrors } = await launchApp({ width: 1500, height: 960, protocolTimeout: 600_000 })
const { re } = reverseHelpers(page)
const at = (point) => re((p) => window.__re.sheet().sheetScreenPoint(p), point)
const pointClick = async (p) => { const pixel = await at(p); await page.mouse.move(pixel.x, pixel.y); await sleep(80); await page.mouse.click(pixel.x, pixel.y); await sleep(150) }
const fill = async (selector, value) => { await page.waitForSelector(selector); await page.focus(selector); await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await page.keyboard.type(String(value)); await page.keyboard.press('Tab'); await sleep(300) }
const newSketch = async () => {
  await re(() => {
    window.__re.store.getState().startSketch({ kind: 'world', axis: 'z', offset: 0 }, { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] })
    window.__re.store.setState((s) => ({ sketchDraft: { ...s.sketchDraft, placing: true } }))
  })
  await page.waitForSelector('[data-test=place-create]')
  if (await page.$eval('[data-test=tool-inspector]', (el) => el.dataset.mode === 'floating')) await click(page, '[data-test=toggle-inspector-dock]')
  await click(page, '[data-test=place-create]')
  await page.waitForSelector('[data-test=sketch-editor]'); await sleep(800)
}
const solidBox = () => page.$eval('[data-test=extrude-solid]', (el) => ({ checked: el.checked, disabled: el.disabled }))
const idle = () => page.waitForFunction(() => !window.__re.store.getState().building, { timeout: 120_000 })
const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
const gripAt = (side) => page.evaluate((side) => { const p = window.__re.scene().gripShownAt(side); return p ? p.map((x) => +x.toFixed(3)) : null }, side)
const previewDone = () => page.waitForFunction(() => { const s = window.__re.store.getState(); return !s.building && s.preview?.status !== 'building' }, { timeout: 120_000 }).catch(() => {})
/** A point on an end arrow where the cursor turns to a grab, found by
 *  walking out from where the arrow is drawn (as the 1.2.13 harness does). */
const findArrow = async (side) => {
  const g = await page.evaluate((side) => {
    const sc = window.__re.scene(), b = sc.gripShownAt(side)
    if (!b) return null
    const s0 = sc.screenPointOf(b), s1 = sc.screenPointOf([b[0], b[1], b[2] + 1])
    return s0 && s1 ? { s0, s1 } : null
  }, side)
  if (!g) return null
  let dx = g.s1.x - g.s0.x, dy = g.s1.y - g.s0.y
  const l = Math.hypot(dx, dy)
  if (l < 1e-6) { dx = 0; dy = -1 } else { dx /= l; dy /= l }
  for (const sign of [1, -1]) for (let k = 4; k <= 52; k += 3) for (const off of [0, -3, 3]) {
    const x = g.s0.x + sign * dx * k - dy * off, y = g.s0.y + sign * dy * k + dx * off
    await page.mouse.move(x, y); await frames()
    const cur = await page.evaluate((x, y) => { const e = document.elementFromPoint(x, y); return e ? getComputedStyle(e).cursor : '' }, x, y)
    if (cur === 'grab') return { x, y, dx, dy }
  }
  return null
}
const model = () => re(() => { const s = window.__re.store.getState(); return { features: s.features.map((f) => ({ id: f.id, kind: f.kind, name: f.name, from: f.from, to: f.to })), bodies: s.bodies.map((b) => ({ id: b.id, surface: !!b.surface, closed: b.closed, volume: b.volume, box: b.box })), error: s.buildError } })
try {
  await loadScan(page, fixture)
  await openReverse(page)
  if (await page.$('[data-test=support-card] .sc-x')) await click(page, '[data-test=support-card] .sc-x')

  // 1. An open L of two lines.
  await newSketch()
  await click(page, '[data-test=sketch-tool-polyline]').catch(() => click(page, '[data-test=sketch-tool-line]'))
  const poly = await page.$('[data-test=sketch-tool-polyline]')
  if (poly) { await pointClick([-6, -4]); await pointClick([4, -4]); await pointClick([4, 5]); await page.keyboard.press('Enter') }
  else { await pointClick([-6, -4]); await pointClick([4, -4]); await click(page, '[data-test=sketch-tool-line]'); await pointClick([4, -4]); await pointClick([4, 5]) }
  await click(page, '[data-test=sketch-tool-select]')
  const open = await re(() => { const d = window.__re.store.getState().sketchDraft; return { lines: d.sketch.entities.filter((e) => e.kind === 'line').length, regions: d.found.length } })
  check(open.lines === 2 && open.regions === 0, `an open L of two lines, no closed region (${JSON.stringify(open)})`)
  await click(page, '[data-test=sketch-extrude]')
  await page.waitForSelector('[data-test=extrude-editor]')
  const box1 = await solidBox()
  check(!box1.checked && box1.disabled, `Extrude opens with Solid unticked and greyed: nothing closed to fill (${JSON.stringify(box1)})`)
  check(/surface/.test(await page.$eval('[data-test=extrude-surface-hint]', (el) => el.textContent)), 'the box says it extrudes as a surface')
  await fill('[data-test=extrude-to]', 12)
  check(!(await page.$eval('[data-test=extrude-create]', (el) => el.disabled)) && (await page.$eval('[data-test=extrude-create]', (el) => el.textContent.trim())) === 'Create surface', 'Create surface is offered')
  check(!(await page.$('[data-test=extrude-taper]')) && !(await page.$('[data-test=extrude-op]')) && (await page.$eval('[data-test=extrude-extent] option[value=toPlane]', (el) => el.disabled)), 'taper, result and the up-to ends are not offered for a surface')
  // The view shows the wall and an arrow at each end, as QUICKSURFACE does.
  await previewDone(); await sleep(400)
  const preview = await re(() => window.__re.store.getState().preview)
  check(preview.status === 'ok', `the wall is previewed by the kernel while the box is open (${preview.status}${preview.message ? ': ' + preview.message : ''})`)
  const top = await gripAt('extrudeTo'), bottom = await gripAt('extrudeFrom')
  check(!!top && !!bottom && Math.abs(top[2] - 12) < 1e-6 && Math.abs(bottom[2]) < 1e-6 && Math.abs(top[0] + 1) < 0.01 && Math.abs(top[1] - 0.5) < 0.01, `an arrow at each end, through the middle of the profile (${JSON.stringify({ top, bottom })})`)
  const words = await page.$$eval('[data-test=extrude-grip-label]', (els) => els.map((el) => el.textContent.trim()))
  check(words.length === 2, `each arrow has its words by it (${JSON.stringify(words)})`)
  await page.screenshot({ path: shotPath('01-open-profile-extrude.png') })
  // Dragging the top arrow along itself makes the surface taller.
  const hold = await findArrow('extrudeTo')
  check(!!hold, 'the top arrow is found under the cursor (grab)')
  if (hold) {
    await page.mouse.down(); await frames()
    for (let i = 1; i <= 12; i++) { await page.mouse.move(hold.x + hold.dx * 5 * i, hold.y + hold.dy * 5 * i); await frames() }
    await page.mouse.up(); await sleep(300)
    const dragged = await re(() => window.__re.store.getState().extrudeDraft.extent)
    check(dragged.kind === 'distance' && dragged.to > 12.5 && dragged.from === 0, `the drag raised the top end and left the bottom (${JSON.stringify(dragged)})`)
    await fill('[data-test=extrude-to]', 12)
  }
  await click(page, '[data-test=extrude-create]'); await sleep(500); await idle(); await sleep(500)
  const m1 = await model()
  const wall = m1.bodies.find((b) => b.surface)
  check(m1.features.at(-1)?.kind === 'sheet' && m1.features.at(-1).from === 0 && m1.features.at(-1).to === 12 && !m1.error, `a surface feature 0…12 is in History (${JSON.stringify(m1.features)})`)
  check(!!wall && !wall.closed && wall.box && Math.abs(wall.box.max[2] - wall.box.min[2] - 12) < 1e-6 && Math.abs(wall.box.max[0] - wall.box.min[0] - 10) < 1e-3 && Math.abs(wall.box.max[1] - wall.box.min[1] - 9) < 1e-3, `the kernel built an open surface 10 × 9 × 12 (${JSON.stringify(wall)})`)
  await page.screenshot({ path: shotPath('02-surface-body.png') })

  // 2. A closed circle: Solid ticked gives a solid; unticked, a tube wall.
  await newSketch()
  await click(page, '[data-test=sketch-tool-circle]'); await pointClick([0, 0]); await pointClick([3, 0]); await click(page, '[data-test=sketch-tool-select]')
  const closed = await re(() => window.__re.store.getState().sketchDraft.found.length)
  check(closed === 1, 'a circle closes one region')
  await click(page, '[data-test=sketch-extrude]')
  await page.waitForSelector('[data-test=extrude-editor]')
  const box2 = await solidBox()
  check(box2.checked && !box2.disabled, `Solid is ticked and can be unticked (${JSON.stringify(box2)})`)
  await click(page, '[data-test=extrude-solid]'); await sleep(200)
  check(!(await solidBox()).checked && !!(await page.$('[data-test=extrude-surface-hint]')), 'unticked: the box turns to a surface extrude')
  await click(page, '[data-test=extrude-solid]'); await sleep(200)
  check((await solidBox()).checked && !(await page.$('[data-test=extrude-surface-hint]')), 'ticked again: back to the solid and its profile')
  await click(page, '[data-test=extrude-solid]'); await sleep(200)
  await fill('[data-test=extrude-to]', 8)
  await click(page, '[data-test=extrude-create]'); await sleep(500); await idle(); await sleep(500)
  const m2 = await model()
  const tube = m2.bodies.filter((b) => b.surface).at(-1)
  check(m2.features.at(-1)?.kind === 'sheet' && m2.bodies.filter((b) => b.surface).length === 2 && !tube.closed && Math.abs(tube.box.max[2] - tube.box.min[2] - 8) < 1e-6 && Math.abs(tube.box.max[0] - tube.box.min[0] - 6) < 1e-2 && !m2.error, `Solid unticked on a circle builds an open tube wall Ø6 × 8, not a solid (${JSON.stringify(tube)})`)

  // 3. One Undo takes the surface away; Redo brings it back.
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control'); await sleep(400); await idle(); await sleep(300)
  check((await model()).features.filter((f) => f.kind === 'sheet').length === 1, 'Undo takes the second surface away')
  await page.keyboard.down('Control'); await page.keyboard.press('y'); await page.keyboard.up('Control'); await sleep(400); await idle(); await sleep(300)
  const m3 = await model()
  check(m3.features.filter((f) => f.kind === 'sheet').length === 2 && m3.bodies.filter((b) => b.surface).length === 2, 'Redo brings it back, built')
  await page.screenshot({ path: shotPath('03-two-surfaces.png') })
  writeFileSync(shotPath('extrude-surface-results.json'), JSON.stringify({ m1, m2, m3 }, null, 2))
} catch (error) { check(false, error.stack ?? error.message) }
await finish(browser, consoleErrors)
