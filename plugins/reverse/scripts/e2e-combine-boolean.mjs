// SPDX-License-Identifier: AGPL-3.0-only
// Combine between two solids: Join, Cut by and Intersect with, each set in
// the rendered Combine box on two overlapping blocks made by extrudes, each
// checked by the kernel's volume, undone, and the last one saved, reopened
// and rebuilt after the first block's sketch is edited.
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { check, click, finish, launchApp, loadScan, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { openReverse, reverseHelpers } from './lib.mjs'

const fixture = shotPath('combine-cylinder-r10.obj'), n = 96, obj = []
for (const z of [-5, 5]) for (let i = 0; i < n; i++) obj.push(`v ${10 * Math.cos(i * Math.PI * 2 / n)} ${10 * Math.sin(i * Math.PI * 2 / n)} ${z}`)
obj.push('v 0 0 -5', 'v 0 0 5')
for (let i = 0; i < n; i++) { const a = i + 1, b = (i + 1) % n + 1, c = a + n, d = b + n; obj.push(`f ${a} ${b} ${d}`, `f ${a} ${d} ${c}`, `f ${2 * n + 1} ${b} ${a}`, `f ${2 * n + 2} ${c} ${d}`) }
writeFileSync(fixture, obj.join('\n'))
const downloads = shotPath(`combine-download-${Date.now()}`)
mkdirSync(downloads, { recursive: true })

const { browser, page, consoleErrors } = await launchApp({ width: 1500, height: 960, protocolTimeout: 600_000 })
const { re, kernelReady } = reverseHelpers(page)
const cdp = await browser.target().createCDPSession()
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true })
page.on('dialog', (dialog) => dialog.accept())
const at = (point) => re((p) => window.__re.sheet().sheetScreenPoint(p), point)
const pointClick = async (p) => { const pixel = await at(p); await page.mouse.move(pixel.x, pixel.y); await sleep(80); await page.mouse.click(pixel.x, pixel.y); await sleep(150) }
const fill = async (selector, value, end = 'Tab') => { await page.waitForSelector(selector); await page.focus(selector); await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await page.keyboard.type(String(value)); await page.keyboard.press(end); await sleep(350) }
const idle = async () => { await sleep(500); await page.waitForFunction(() => { const s = window.__re.store.getState(); return !s.building && s.preview?.status !== 'building' }, { timeout: 180_000 }); await sleep(400) }
const solids = () => re(() => window.__re.store.getState().bodies.filter((b) => !b.surface).map((b) => ({ id: b.id, name: b.name, volume: b.volume, closed: b.closed })))
const undo = async () => { await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control'); await idle() }
const about = (a, b, rel = 2e-3) => Math.abs(a - b) <= rel * Math.abs(b)
const block = async (p, q, height) => {
  await re(() => {
    window.__re.store.getState().startSketch({ kind: 'world', axis: 'z', offset: 0 }, { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] })
    window.__re.store.setState((s) => ({ sketchDraft: { ...s.sketchDraft, placing: true } }))
  })
  await page.waitForSelector('[data-test=place-create]')
  if (await page.$eval('[data-test=tool-inspector]', (el) => el.dataset.mode === 'floating')) await click(page, '[data-test=toggle-inspector-dock]')
  await click(page, '[data-test=place-create]')
  await page.waitForSelector('[data-test=sketch-editor]'); await sleep(800)
  await click(page, '[data-test=sketch-tool-rectangle]'); await pointClick(p); await pointClick(q); await click(page, '[data-test=sketch-tool-select]')
  // Exact sides: the rectangle's width and height typed as dimensions would
  // be the long way round; the corners are set to the millimetre instead.
  await re(([p, q]) => { const s = window.__re.store.getState(), d = s.sketchDraft, sk = structuredClone(d.sketch); const fix = (v) => [Math.abs(v[0] - p[0]) < Math.abs(v[0] - q[0]) ? p[0] : q[0], Math.abs(v[1] - p[1]) < Math.abs(v[1] - q[1]) ? p[1] : q[1]]; sk.entities = sk.entities.map((e) => (e.kind === 'line' ? { ...e, a: fix(e.a), b: fix(e.b) } : e)); s.setSketch(sk) }, [p, q])
  await click(page, '[data-test=sketch-extrude]'); await page.waitForSelector('[data-test=extrude-editor]')
  await page.select('[data-test=extrude-op]', 'new'); await sleep(200)
  await fill('[data-test=extrude-to]', height); await idle()
  await click(page, '[data-test=extrude-create]'); await idle()
}
const combine = async (op, bodyId, toolId, keep = false) => {
  await re((op) => window.__re.store.getState().startFeature('boolean', { op }), op)
  await page.waitForSelector('[data-test=boolean-op]')
  check(await page.$eval('[data-test=boolean-op]', (el) => el.value) === op, `the Combine box opens on ${op}`)
  await page.select('[data-test=boolean-body]', String(bodyId)); await page.select('[data-test=boolean-tool]', String(toolId)); await sleep(200)
  if (keep !== await page.$eval('[data-test=boolean-keep]', (el) => el.checked)) await click(page, '[data-test=boolean-keep]')
  await idle()
  const preview = await re(() => window.__re.store.getState().preview)
  check(preview.status === 'ok', `${op}: the result previews before it is made (${preview.status}${preview.message ? ': ' + preview.message : ''})`)
  await page.waitForSelector('[data-test=boolean-create]:not([disabled])')
  await click(page, '[data-test=boolean-create]'); await idle()
}
// Block A: 20 × 10 × 8 at x 0…20. Block B: 10 × 10 × 8 at x 15…25. They share 5 × 10 × 8.
const A = 20 * 10 * 8, B = 10 * 10 * 8, COMMON = 5 * 10 * 8
try {
  await loadScan(page, fixture)
  await openReverse(page)
  if (await page.$('[data-test=support-card] .sc-x')) await click(page, '[data-test=support-card] .sc-x')
  await block([-10, -5], [10, 5], 8)
  await block([5, -5], [15, 5], 8)
  let s = await solids()
  check(s.length === 2 && about(s[0].volume, A, 1e-6) && about(s[1].volume, B, 1e-6), `two separate solids, ${A} and ${B} mm³ (${s.map((b) => b.volume.toFixed(3)).join(', ')})`)
  const [a, b] = s.map((x) => x.id)

  await combine('join', a, b)
  s = await solids()
  check(s.length === 1 && s[0].closed && about(s[0].volume, A + B - COMMON, 1e-6), `Join: one solid of ${A + B - COMMON} mm³ (${s.map((x) => x.volume.toFixed(3)).join(', ')})`)
  await page.screenshot({ path: shotPath('01-join.png') })
  await undo()
  check((await solids()).length === 2, 'Undo gives the two blocks back')

  await combine('cut', a, b)
  s = await solids()
  check(s.length === 1 && s[0].closed && about(s[0].volume, A - COMMON, 1e-6), `Cut by: the first block less the overlap, ${A - COMMON} mm³, the tool gone into it (${s.map((x) => x.volume.toFixed(3)).join(', ')})`)
  await undo()

  await combine('cut', a, b, true)
  s = await solids()
  check(s.length === 2 && s.some((x) => about(x.volume, A - COMMON, 1e-6)) && s.some((x) => about(x.volume, B, 1e-6)), `Cut by with Keep the tool body: both stay, the first cut (${s.map((x) => x.volume.toFixed(3)).join(', ')})`)
  await undo()

  await combine('intersect', a, b)
  s = await solids()
  check(s.length === 1 && s[0].closed && about(s[0].volume, COMMON, 1e-6), `Intersect with: only the shared ${COMMON} mm³ (${s.map((x) => x.volume.toFixed(3)).join(', ')})`)
  await page.screenshot({ path: shotPath('02-intersect.png') })

  // The first block's sketch made 2 mm longer towards the second: the
  // overlap, and so the intersection, grows by 2 × 10 × 8.
  const firstSketch = await re(() => window.__re.store.getState().features.find((f) => f.kind === 'sketch').id)
  const row = `[data-test="explorer-history-feature-${firstSketch}"]`
  await page.waitForSelector(row); await page.click(row, { count: 2 }); await page.waitForSelector('[data-test=sketch-editor]'); await sleep(800)
  await re(() => { const st = window.__re.store.getState(), sk = structuredClone(st.sketchDraft.sketch); sk.entities = sk.entities.map((e) => (e.kind === 'line' ? { ...e, a: [e.a[0] === 10 ? 12 : e.a[0], e.a[1]], b: [e.b[0] === 10 ? 12 : e.b[0], e.b[1]] } : e)); st.setSketch(sk) })
  await click(page, '[data-test=sketch-ok-cancel] button.primary'); await idle(); await idle()
  s = await solids()
  check(s.length === 1 && about(s[0].volume, COMMON + 2 * 10 * 8, 1e-6), `the first sketch widened by 2: the intersection rebuilds to ${COMMON + 160} mm³ (${s.map((x) => x.volume.toFixed(3)).join(', ')})`)

  await fill('[data-test=project-name]', 'combine-boolean')
  await click(page, '[data-test=save-project]')
  let file = null
  for (let i = 0; i < 150 && !file; i++) { await sleep(200); const name = readdirSync(downloads).find((f) => f.endsWith('.scanruler')); if (name) file = join(downloads, name) }
  check(!!file, 'the project is saved')
  await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('.panel')
  await (await page.$('[data-test=project-input]')).uploadFile(file)
  await page.waitForFunction(() => /Project opened/.test(document.querySelector('.strip')?.textContent ?? ''), { timeout: 120_000 })
  await kernelReady(); await page.waitForFunction(() => window.__re.store.getState().bodies.length >= 1, { timeout: 180_000 }); await idle()
  s = await solids()
  const kinds = await re(() => window.__re.store.getState().features.map((f) => f.kind + (f.op ? ':' + f.op : '')).join(' '))
  check(s.length === 1 && about(s[0].volume, COMMON + 160, 1e-6) && kinds === 'sketch extrude:new sketch extrude:new boolean:intersect', `reopened: the same intersection, History ${kinds}`)
  writeFileSync(shotPath('combine-results.json'), JSON.stringify({ s, kinds }, null, 2))
} catch (error) { check(false, error.stack ?? error.message) }
await finish(browser, consoleErrors)
