// SPDX-License-Identifier: AGPL-3.0-only
// Revolve from a sketch, end to end: a rectangle beside the sheet's vertical
// axis, the sketch's own Revolve key, the axis chosen in the box, a full turn
// (a ring), then 90°, then the sketch edited and the ring rebuilt. Volumes
// from the kernel against the ring's formula.
import { writeFileSync } from 'node:fs'
import { check, click, finish, launchApp, loadScan, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { openReverse, reverseHelpers } from './lib.mjs'

const fixture = shotPath('revolve-cylinder-r10.obj'), n = 96, obj = []
for (const z of [-5, 5]) for (let i = 0; i < n; i++) obj.push(`v ${10 * Math.cos(i * Math.PI * 2 / n)} ${10 * Math.sin(i * Math.PI * 2 / n)} ${z}`)
obj.push('v 0 0 -5', 'v 0 0 5')
for (let i = 0; i < n; i++) { const a = i + 1, b = (i + 1) % n + 1, c = a + n, d = b + n; obj.push(`f ${a} ${b} ${d}`, `f ${a} ${d} ${c}`, `f ${2 * n + 1} ${b} ${a}`, `f ${2 * n + 2} ${c} ${d}`) }
writeFileSync(fixture, obj.join('\n'))

const { browser, page, consoleErrors } = await launchApp({ width: 1500, height: 960, protocolTimeout: 600_000 })
const { re } = reverseHelpers(page)
const at = (point) => re((p) => window.__re.sheet().sheetScreenPoint(p), point)
const pointClick = async (p) => { const pixel = await at(p); await page.mouse.move(pixel.x, pixel.y); await sleep(80); await page.mouse.click(pixel.x, pixel.y); await sleep(150) }
const fill = async (selector, value, end = 'Tab') => { await page.waitForSelector(selector); await page.focus(selector); await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await page.keyboard.type(String(value)); await page.keyboard.press(end); await sleep(350) }
const idle = async () => { await sleep(500); await page.waitForFunction(() => { const s = window.__re.store.getState(); return !s.building && s.preview?.status !== 'building' }, { timeout: 180_000 }); await sleep(400) }
const solids = () => re(() => window.__re.store.getState().bodies.filter((b) => !b.surface).map((b) => ({ volume: b.volume, closed: b.closed, box: b.box })))
const about = (a, b, rel = 2e-3) => Math.abs(a - b) <= rel * Math.abs(b)
// A w × h section whose near side is r0 from the axis, turned through `deg`.
const ring = (r0, w, h, deg = 360) => Math.PI * ((r0 + w) ** 2 - r0 ** 2) * h * (deg / 360)
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
  await click(page, '[data-test=sketch-tool-rectangle]'); await pointClick([4, -2]); await pointClick([7, 2]); await click(page, '[data-test=sketch-tool-select]')
  await re(() => { const s = window.__re.store.getState(), sk = structuredClone(s.sketchDraft.sketch); const sx = (v) => (Math.abs(v - 4) < Math.abs(v - 7) ? 4 : 7), sy = (v) => (v < 0 ? -2 : 2); sk.entities = sk.entities.map((e) => (e.kind === 'line' ? { ...e, a: [sx(e.a[0]), sy(e.a[1])], b: [sx(e.b[0]), sy(e.b[1])] } : e)); s.setSketch(sk) })
  check(!(await page.$eval('[data-test=sketch-revolve]', (el) => el.disabled)), 'the sketch offers Revolve once it closes a region')
  await click(page, '[data-test=sketch-revolve]')
  await page.waitForSelector('[data-test=revolve-editor]')
  await click(page, '[data-test=revolve-axis]'); await page.waitForSelector('[data-test=revolve-axis-list]'); await sleep(200)
  const axes = await page.$$eval('[data-test=revolve-axis-list] [data-test=pick-option]', (els) => els.map((el) => el.textContent.trim()))
  // The sheet's vertical through the origin: the part's Y axis.
  const index = axes.findIndex((t) => t.split(/[^A-Za-z]+/).includes('Y'))
  check(index >= 0, `the Axis list offers the part's axes and the sketch's lines (${JSON.stringify(axes)})`)
  await (await page.$$('[data-test=revolve-axis-list] [data-test=pick-option]'))[index].click(); await idle()
  const preview = await re(() => window.__re.store.getState().preview)
  check(preview.status === 'ok', `the ring previews (${preview.status}${preview.message ? ': ' + preview.message : ''})`)
  await page.screenshot({ path: shotPath('01-revolve-preview.png') })
  await click(page, '[data-test=revolve-create]'); await idle()
  let s = await solids()
  check(s.length === 1 && s[0].closed && about(s[0].volume, ring(4, 3, 4)), `a full turn makes a closed ring of ${ring(4, 3, 4).toFixed(1)} mm³ (${s[0]?.volume?.toFixed(2)})`)

  // Edited from History to 90°.
  const rev = await re(() => window.__re.store.getState().features.find((f) => f.kind === 'revolve').id)
  const row = `[data-test="explorer-history-feature-${rev}"]`
  await page.waitForSelector(row); await page.click(row, { count: 2 }); await page.waitForSelector('[data-test=revolve-editor]'); await sleep(500)
  await fill('[data-test=revolve-angle]', 90); await idle()
  await click(page, '[data-test=revolve-create]'); await idle()
  s = await solids()
  check(s.length === 1 && s[0].closed && about(s[0].volume, ring(4, 3, 4, 90)), `90° typed in the reopened box makes a quarter ring, ${ring(4, 3, 4, 90).toFixed(1)} mm³ (${s[0]?.volume?.toFixed(2)})`)

  // The section made 1 wider away from the axis: the revolve follows.
  const sketch = await re(() => window.__re.store.getState().features.find((f) => f.kind === 'sketch').id)
  const srow = `[data-test="explorer-history-feature-${sketch}"]`
  await page.click(srow, { count: 2 }); await page.waitForSelector('[data-test=sketch-editor]'); await sleep(800)
  await re(() => { const st = window.__re.store.getState(), sk = structuredClone(st.sketchDraft.sketch); sk.entities = sk.entities.map((e) => (e.kind === 'line' ? { ...e, a: [e.a[0] === 7 ? 8 : e.a[0], e.a[1]], b: [e.b[0] === 7 ? 8 : e.b[0], e.b[1]] } : e)); st.setSketch(sk) })
  await click(page, '[data-test=sketch-ok-cancel] button.primary'); await idle(); await idle()
  s = await solids()
  check(s.length === 1 && about(s[0].volume, ring(4, 4, 4, 90)), `the section widened by 1: the quarter ring rebuilds to ${ring(4, 4, 4, 90).toFixed(1)} mm³ (${s[0]?.volume?.toFixed(2)})`)
  await page.evaluate(() => document.activeElement?.blur())
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control'); await idle()
  s = await solids()
  check(about(s[0].volume, ring(4, 3, 4, 90)), `Undo rebuilds it as it was (${s[0]?.volume?.toFixed(2)})`)
} catch (error) { check(false, error.stack ?? error.message) }
await finish(browser, consoleErrors)
