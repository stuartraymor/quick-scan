// SPDX-License-Identifier: AGPL-3.0-only
// Extrude's three results on an existing solid, end to end, as QUICKSURFACE's
// Extruded dialog names them (read 2026-11-22): New Solid, Combine (Join),
// Cut. A base block; a hole cut through it from a second sketch; a boss
// joined on from a third; a separate body from a fourth. Then the hole's
// sketch is edited and everything after it rebuilds; the project is saved
// and reopened; and the steps are undone. Sketches are drawn and features
// set through the rendered controls; volumes come from the kernel.
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { check, click, finish, launchApp, loadScan, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { openReverse, reverseHelpers } from './lib.mjs'

const fixture = shotPath('boolean-cylinder-r10.obj'), n = 96, obj = []
for (const z of [-5, 5]) for (let i = 0; i < n; i++) obj.push(`v ${10 * Math.cos(i * Math.PI * 2 / n)} ${10 * Math.sin(i * Math.PI * 2 / n)} ${z}`)
obj.push('v 0 0 -5', 'v 0 0 5')
for (let i = 0; i < n; i++) { const a = i + 1, b = (i + 1) % n + 1, c = a + n, d = b + n; obj.push(`f ${a} ${b} ${d}`, `f ${a} ${d} ${c}`, `f ${2 * n + 1} ${b} ${a}`, `f ${2 * n + 2} ${c} ${d}`) }
writeFileSync(fixture, obj.join('\n'))
const downloads = shotPath(`boolean-download-${Date.now()}`)
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
const model = () => re(() => { const s = window.__re.store.getState(); return { features: s.features.map((f) => ({ id: f.id, kind: f.kind, name: f.name, op: f.op, extent: f.extent })), bodies: s.bodies.map((b) => ({ id: b.id, name: b.name, volume: b.volume, closed: b.closed, surface: !!b.surface, box: b.box })), error: s.buildError, failed: Object.values(s.results ?? {}).filter((r) => r && (r.failed || r.status === 'failed')).map((r) => r.message ?? r.failed) } })
const solids = (m) => m.bodies.filter((b) => !b.surface)
const about = (a, b, rel = 3e-3) => Math.abs(a - b) <= rel * Math.abs(b)
const newSketch = async (offset = 0) => {
  await re((offset) => {
    window.__re.store.getState().startSketch({ kind: 'world', axis: 'z', offset }, { origin: [0, 0, offset], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] })
    window.__re.store.setState((s) => ({ sketchDraft: { ...s.sketchDraft, placing: true } }))
  }, offset)
  await page.waitForSelector('[data-test=place-create]')
  if (await page.$eval('[data-test=tool-inspector]', (el) => el.dataset.mode === 'floating')) await click(page, '[data-test=toggle-inspector-dock]')
  await click(page, '[data-test=place-create]')
  await page.waitForSelector('[data-test=sketch-editor]'); await sleep(800)
}
const circle = async (c, r) => { await click(page, '[data-test=sketch-tool-circle]'); await pointClick(c); await pointClick([c[0] + r, c[1]]); await click(page, '[data-test=sketch-tool-select]') }
const opWords = () => page.$$eval('[data-test=extrude-op] option', (els) => els.map((el) => el.textContent.trim()))
const preview = () => re(() => { const p = window.__re.store.getState().preview; return { status: p.status, volume: p.volume, message: p.message } })
const BASE = 20 * 12 * 6
const disc = (d, h) => Math.PI * (d / 2) ** 2 * h
try {
  await loadScan(page, fixture)
  await openReverse(page)
  if (await page.$('[data-test=support-card] .sc-x')) await click(page, '[data-test=support-card] .sc-x')

  // 1. The base block: a 20 × 12 rectangle, 6 high.
  await newSketch(0)
  await click(page, '[data-test=sketch-tool-rectangle]'); await pointClick([-10, -6]); await pointClick([10, 6]); await click(page, '[data-test=sketch-tool-select]')
  await click(page, '[data-test=sketch-extrude]'); await page.waitForSelector('[data-test=extrude-editor]')
  check(JSON.stringify(await opWords()) === JSON.stringify(['New Solid', 'Combine (Join)', 'Cut']), `the Result list reads as QUICKSURFACE's: ${JSON.stringify(await opWords())}`)
  check((await page.$$eval('[data-test=extrude-extent] option', (els) => els.map((el) => el.textContent.trim()))).includes('Mirrored'), 'the extent list offers Mirrored')
  check(await page.$eval('[data-test=extrude-op] option[value=cut]', (el) => el.disabled), 'Cut is greyed while there is no solid to cut')
  await fill('[data-test=extrude-to]', 6); await idle()
  // Set sketch on: Top plane, then Bottom plane — the body stays, the sketch moves.
  const depths = () => page.evaluate(() => [document.querySelector('[data-test=extrude-to]').value, document.querySelector('[data-test=extrude-from]').value])
  const sketchZ = () => re(() => { const s = window.__re.store.getState(); return s.features.find((f) => f.kind === 'sketch' && f.id === s.extrudeDraft.sketchId).frame.origin[2] })
  await click(page, '[data-test=extrude-sketch-on-top]'); await idle()
  const onTop = { depths: await depths(), z: await sketchZ(), extent: await re(() => window.__re.store.getState().extrudeDraft.extent) }
  check(onTop.z === 6 && onTop.extent.from === -6 && onTop.extent.to === 0, `Set sketch on Top plane: the sketch is at z 6 and the body still runs 0 to 6 (${JSON.stringify(onTop)})`)
  await click(page, '[data-test=extrude-sketch-on-bottom]'); await idle()
  const onBottom = { depths: await depths(), z: await sketchZ(), extent: await re(() => window.__re.store.getState().extrudeDraft.extent) }
  check(onBottom.z === 0 && onBottom.extent.from === 0 && onBottom.extent.to === 6 && onBottom.depths[0] === '6', `Bottom plane puts it back at z 0, depth 6 (${JSON.stringify(onBottom)})`)
  await click(page, '[data-test=extrude-create]'); await idle()
  let m = await model()
  check(solids(m).length === 1 && solids(m)[0].closed && about(solids(m)[0].volume, BASE, 1e-3), `base: one closed solid of ${BASE} mm³ (${solids(m)[0]?.volume?.toFixed(2)})`)
  check(m.features.at(-1).extent.to === 6 && solids(m)[0].box.max[2] === 6, `6 typed over the depth the box opened on is exactly 6, not what it was rounded from (${m.features.at(-1).extent.to})`)

  // 2. Cut: a Ø6 circle on the same plane, cut through the block.
  await newSketch(0)
  await circle([-4, 0], 3)
  await click(page, '[data-test=sketch-extrude]'); await page.waitForSelector('[data-test=extrude-editor]')
  await page.select('[data-test=extrude-op]', 'cut'); await sleep(300)
  const opened = await re(() => window.__re.store.getState().extrudeDraft.extent)
  check(opened.kind === 'distance' && opened.to > 0 && opened.from === 0, `Cut opens pointing into the block above the sketch, not away from it (${JSON.stringify(opened)})`)
  await fill('[data-test=extrude-to]', 6); await idle()
  const cutPreview = await preview()
  check(cutPreview.status === 'ok', `the cut previews before it is made (${JSON.stringify(cutPreview)})`)
  await page.screenshot({ path: shotPath('01-cut-preview.png') })
  await click(page, '[data-test=extrude-create]'); await idle()
  m = await model()
  const afterCut = BASE - disc(6, 6)
  check(solids(m).length === 1 && solids(m)[0].closed && about(solids(m)[0].volume, afterCut), `Cut: the block less a Ø6 hole, ${afterCut.toFixed(1)} mm³ (${solids(m)[0]?.volume?.toFixed(2)})`)
  check(m.features.at(-1).kind === 'extrude' && m.features.at(-1).op === 'cut', 'the cut is its own extrude in History')
  const holeSketch = m.features.filter((f) => f.kind === 'sketch').at(-1).id

  // 3. Combine (Join): a Ø4 boss on the top face, 5 high.
  await newSketch(6)
  await circle([5, 0], 2)
  await click(page, '[data-test=sketch-extrude]'); await page.waitForSelector('[data-test=extrude-editor]')
  check(await page.$eval('[data-test=extrude-op]', (el) => el.value) === 'join', 'Combine (Join) is what a new extrude opens on')
  await fill('[data-test=extrude-to]', 5); await idle()
  const joinPreview = await preview()
  check(joinPreview.status === 'ok', `the boss previews (${JSON.stringify(joinPreview)})`)
  await click(page, '[data-test=extrude-create]'); await idle()
  m = await model()
  const afterJoin = afterCut + disc(4, 5)
  check(solids(m).length === 1 && solids(m)[0].closed && about(solids(m)[0].volume, afterJoin), `Combine (Join): one solid with the boss on, ${afterJoin.toFixed(1)} mm³ (${solids(m)[0]?.volume?.toFixed(2)})`)

  // 4. New Solid: a Ø3 pin standing in the block, kept a body of its own.
  await newSketch(0)
  await circle([5, -3], 1.5)
  await click(page, '[data-test=sketch-extrude]'); await page.waitForSelector('[data-test=extrude-editor]')
  await page.select('[data-test=extrude-op]', 'new'); await sleep(200)
  await fill('[data-test=extrude-to]', 9); await idle()
  await click(page, '[data-test=extrude-create]'); await idle()
  m = await model()
  const pin = solids(m).find((b) => about(b.volume, disc(3, 9), 5e-3))
  check(solids(m).length === 2 && !!pin && solids(m).some((b) => about(b.volume, afterJoin)), `New Solid: the pin is a second body and the block is untouched (${solids(m).map((b) => b.volume.toFixed(1)).join(', ')})`)
  await page.screenshot({ path: shotPath('02-four-features.png') })
  const kinds = m.features.map((f) => f.kind + (f.op ? ':' + f.op : '')).join(' ')
  check(kinds === 'sketch extrude:join sketch extrude:cut sketch extrude:join sketch extrude:new', `History holds the four pairs in order (${kinds})`)

  // 5. The hole's sketch edited: Ø6 → Ø8. The cut, the boss and the pin rebuild.
  const row = `[data-test="explorer-history-feature-${holeSketch}"]`
  await page.waitForSelector(row); await page.click(row, { count: 2 }); await page.waitForSelector('[data-test=sketch-editor]'); await sleep(800)
  await click(page, '[data-test=sketch-dimension]'); await pointClick([-4 + 3 * Math.SQRT1_2, 3 * Math.SQRT1_2]); await pointClick([-9, 7])
  const dim = await re(() => window.__re.store.getState().sketchDraft.sketch.constraints.find((c) => c.kind === 'diameter')?.id)
  await fill(`[data-test="flat-dimension-${dim}"] input`, 8, 'Enter')
  await click(page, '[data-test=sketch-ok-cancel] button.primary'); await idle(); await idle()
  m = await model()
  const afterEdit = BASE - disc(8, 6) + disc(4, 5)
  check(solids(m).length === 2 && solids(m).some((b) => about(b.volume, afterEdit)) && solids(m).some((b) => about(b.volume, disc(3, 9), 5e-3)) && !m.error && m.failed.length === 0, `hole to Ø8: the block rebuilds to ${afterEdit.toFixed(1)} mm³ with boss and pin kept (${solids(m).map((b) => b.volume.toFixed(1)).join(', ')}; failed ${JSON.stringify(m.failed)})`)
  await page.screenshot({ path: shotPath('03-hole-edited.png') })

  // 6. Save, reload, reopen: the same two bodies.
  await fill('[data-test=project-name]', 'extrude-boolean')
  await click(page, '[data-test=save-project]')
  let file = null
  for (let i = 0; i < 150 && !file; i++) { await sleep(200); const name = readdirSync(downloads).find((f) => f.endsWith('.scanruler')); if (name) file = join(downloads, name) }
  check(!!file, 'the project is saved')
  const saved = solids(m).map((b) => b.volume).sort((a, b) => a - b)
  await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('.panel')
  await (await page.$('[data-test=project-input]')).uploadFile(file)
  await page.waitForFunction(() => /Project opened/.test(document.querySelector('.strip')?.textContent ?? ''), { timeout: 120_000 })
  await kernelReady(); await page.waitForFunction(() => window.__re.store.getState().bodies.length >= 2, { timeout: 180_000 }); await idle()
  m = await model()
  const reopened = solids(m).map((b) => b.volume).sort((a, b) => a - b)
  check(reopened.length === 2 && reopened.every((v, i) => about(v, saved[i], 1e-6)) && m.features.filter((f) => f.kind === 'extrude').map((f) => f.op).join(',') === 'join,cut,join,new', `reopened: the same two bodies and the four extrudes with their results (${reopened.map((v) => v.toFixed(1)).join(', ')})`)

  // 7. The cut edited from History: its result switched to New Solid and back.
  const cutId = m.features.find((f) => f.kind === 'extrude' && f.op === 'cut').id
  const cutRow = `[data-test="explorer-history-feature-${cutId}"]`
  await page.waitForSelector(cutRow); await page.click(cutRow, { count: 2 }); await page.waitForSelector('[data-test=extrude-editor]'); await sleep(500)
  check(await page.$eval('[data-test=extrude-op]', (el) => el.value) === 'cut', 'a double-click on the cut in History opens it with Cut set')
  await click(page, '[data-test=extrude-cancel]'); await idle()
  check(about(solids(await model()).map((b) => b.volume).sort((a, b) => a - b)[1], saved[1], 1e-6), 'Cancel leaves the model as it was')
  writeFileSync(shotPath('extrude-boolean-results.json'), JSON.stringify({ saved, reopened, kinds }, null, 2))
} catch (error) { check(false, error.stack ?? error.message) }
await finish(browser, consoleErrors)
