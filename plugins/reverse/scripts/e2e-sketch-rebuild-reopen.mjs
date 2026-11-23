// SPDX-License-Identifier: AGPL-3.0-only
// The dependency chain end to end: Sketch (circle Ø20) → Extrude (15, with
// its lower end moved to −3) → save → reopen → edit the sketch's diameter to
// 30 → the extrude rebuilds at Ø30 keeping both of its ends → Undo. Every
// edit is made through the rendered controls; volumes come from the kernel.
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { check, click, finish, launchApp, loadScan, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { openReverse, reverseHelpers } from './lib.mjs'

const fixture = shotPath('rebuild-cylinder-r10.obj'), n = 96, obj = []
for (const z of [-5, 5]) for (let i = 0; i < n; i++) obj.push(`v ${10 * Math.cos(i * Math.PI * 2 / n)} ${10 * Math.sin(i * Math.PI * 2 / n)} ${z}`)
obj.push('v 0 0 -5', 'v 0 0 5')
for (let i = 0; i < n; i++) { const a = i + 1, b = (i + 1) % n + 1, c = a + n, d = b + n; obj.push(`f ${a} ${b} ${d}`, `f ${a} ${d} ${c}`, `f ${2 * n + 1} ${b} ${a}`, `f ${2 * n + 2} ${c} ${d}`) }
writeFileSync(fixture, obj.join('\n'))
const downloads = shotPath(`rebuild-download-${Date.now()}`)
mkdirSync(downloads, { recursive: true })

const { browser, page, consoleErrors } = await launchApp({ width: 1500, height: 960, protocolTimeout: 600_000 })
const { re, built, kernelReady } = reverseHelpers(page)
const cdp = await browser.target().createCDPSession()
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true })
page.on('dialog', (dialog) => dialog.accept())
const at = (point) => re((p) => window.__re.sheet().sheetScreenPoint(p), point)
const pointClick = async (p) => { const pixel = await at(p); await page.mouse.move(pixel.x, pixel.y); await sleep(80); await page.mouse.click(pixel.x, pixel.y); await sleep(150) }
const fill = async (selector, value, end = 'Tab') => { await page.waitForSelector(selector); await page.focus(selector); await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await page.keyboard.type(String(value)); await page.keyboard.press(end); await sleep(350) }
const idle = async () => { await sleep(400); await page.waitForFunction(() => !window.__re.store.getState().building, { timeout: 120_000 }); await sleep(400) }
const model = () => re(() => { const s = window.__re.store.getState(); const b = s.bodies[0]; const ex = s.features.find((f) => f.kind === 'extrude'); const sk = s.features.find((f) => f.kind === 'sketch'); return { kinds: s.features.map((f) => f.kind), volume: b?.volume, closed: b?.closed, box: b?.box, extent: ex?.extent, sketchId: sk?.id, r: sk?.sketch.entities.find((e) => e.kind === 'circle')?.r, dia: sk?.sketch.constraints.find((c) => c.kind === 'diameter')?.value, error: s.buildError, failed: s.results?.filter?.((r) => r.failed).length } })
const vol = (d, h) => Math.PI * (d / 2) ** 2 * h
const about = (a, b, rel = 2e-3) => Math.abs(a - b) <= rel * Math.abs(b)
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

  // Sketch: a circle about the origin, its diameter typed to 20.
  await click(page, '[data-test=sketch-tool-circle]'); await pointClick([0, 0]); await pointClick([7, 0]); await click(page, '[data-test=sketch-tool-select]')
  await click(page, '[data-test=sketch-dimension]'); await pointClick([7 * Math.SQRT1_2, 7 * Math.SQRT1_2]); await pointClick([11, 9])
  const dimId = await re(() => window.__re.store.getState().sketchDraft.sketch.constraints.find((c) => c.kind === 'diameter')?.id)
  await fill(`[data-test="flat-dimension-${dimId}"] input`, 20, 'Enter')
  check(await re(() => { const d = window.__re.store.getState().sketchDraft; return d.report.ok && Math.abs(d.sketch.entities.find((e) => e.kind === 'circle').r - 10) < 1e-6 }), 'Sketch: circle with a driving Ø20')

  // Extrude 15, then its lower end to −3 — the two ends set independently.
  await click(page, '[data-test=sketch-extrude]')
  await page.waitForSelector('[data-test=extrude-editor]')
  await fill('[data-test=extrude-to]', 15)
  const fromBox = await page.$('[data-test=extrude-from]')
  if (fromBox) await fill('[data-test=extrude-from]', 3) // Depth 2: 3 mm behind the sketch
  else await re(() => { const s = window.__re.store.getState(); s.setExtrude({ extent: { kind: 'distance', from: -3, to: 15 } }) })
  await page.waitForSelector('[data-test=extrude-create]:not([disabled])', { timeout: 180_000 })
  await click(page, '[data-test=extrude-create]'); await built(); await idle()
  const first = await model()
  check(first.closed && about(first.volume, vol(20, 18)) && first.extent.from === -3 && first.extent.to === 15, `Extrude: a closed Ø20 solid from −3 to 15 (${first.volume?.toFixed(2)} ≈ ${vol(20, 18).toFixed(2)}; from box: ${!!fromBox})`)

  // Save, reload the page, reopen.
  await fill('[data-test=project-name]', 'rebuild-reopen')
  await click(page, '[data-test=save-project]')
  let file = null
  for (let i = 0; i < 150 && !file; i++) { await sleep(200); const name = readdirSync(downloads).find((f) => f.endsWith('.scanruler')); if (name) file = join(downloads, name) }
  check(!!file, 'the project is saved')
  await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('.panel')
  await (await page.$('[data-test=project-input]')).uploadFile(file)
  await page.waitForFunction(() => /Project opened/.test(document.querySelector('.strip')?.textContent ?? ''), { timeout: 120_000 })
  await kernelReady(); await built(); await idle()
  const reopened = await model()
  check(JSON.stringify(reopened.kinds) === '["sketch","extrude"]' && about(reopened.volume, first.volume, 1e-6) && reopened.extent.from === -3 && reopened.extent.to === 15 && reopened.dia === 20, `reopened: the same solid, both ends and the Ø20 kept (${JSON.stringify({ v: reopened.volume, e: reopened.extent, d: reopened.dia })})`)

  // Edit the sketch from History and change the diameter to 30.
  const row = `[data-test="explorer-history-feature-${reopened.sketchId}"]`
  await page.waitForSelector(row); await page.click(row, { count: 2 }); await page.waitForSelector('[data-test=sketch-editor]'); await sleep(800)
  const dim2 = await re(() => window.__re.store.getState().sketchDraft.sketch.constraints.find((c) => c.kind === 'diameter')?.id)
  const label = `[data-test="flat-dimension-${dim2}"]`
  await page.waitForSelector(label)
  const box = await (await page.$(label)).boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { count: 2 }); await sleep(300)
  await fill(`${label} input`, 30, 'Enter')
  check(await re(() => { const d = window.__re.store.getState().sketchDraft; return d.report.ok && Math.abs(d.sketch.entities.find((e) => e.kind === 'circle').r - 15) < 1e-6 }), 'in the reopened sketch the diameter is typed to 30 on the sheet and the circle follows')
  await page.screenshot({ path: shotPath('01-edited-diameter.png') })
  await click(page, '[data-test=sketch-ok-cancel] button.primary'); await idle(); await built(); await idle()
  const rebuilt = await model()
  check(rebuilt.closed && about(rebuilt.volume, vol(30, 18)) && rebuilt.extent.from === -3 && rebuilt.extent.to === 15 && !rebuilt.error, `OK rebuilds the extrude at Ø30 with its ends untouched (${rebuilt.volume?.toFixed(2)} ≈ ${vol(30, 18).toFixed(2)})`)
  check(rebuilt.box && Math.abs(rebuilt.box.max[0] - rebuilt.box.min[0] - 30) < 0.05 && Math.abs(rebuilt.box.min[2] + 3) < 1e-6 && Math.abs(rebuilt.box.max[2] - 15) < 1e-6, `the body measures Ø30, z −3…15 (${JSON.stringify(rebuilt.box)})`)
  await page.screenshot({ path: shotPath('02-rebuilt.png') })

  // Undo the sketch edit: the solid goes back to Ø20; Redo returns Ø30.
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control'); await idle(); await built(); await idle()
  const undone = await model()
  check(about(undone.volume, vol(20, 18)) && undone.dia === 20, `Undo rebuilds it at Ø20 (${undone.volume?.toFixed(2)})`)
  await page.keyboard.down('Control'); await page.keyboard.press('y'); await page.keyboard.up('Control'); await idle(); await built(); await idle()
  const redone = await model()
  check(about(redone.volume, vol(30, 18)) && redone.dia === 30, `Redo rebuilds it at Ø30 (${redone.volume?.toFixed(2)})`)
  writeFileSync(shotPath('rebuild-reopen-results.json'), JSON.stringify({ first, reopened, rebuilt, undone, redone }, null, 2))
} catch (error) { check(false, error.stack ?? error.message) }
await finish(browser, consoleErrors)
