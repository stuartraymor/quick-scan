// SPDX-License-Identifier: AGPL-3.0-only
// Full user workflow on a real mesh: section points -> circular brush fit ->
// graphical constraints/dimension -> OCCT solid -> actual archive round trip.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { check, click, finish, launchApp, loadScan, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { openReverse, reverseHelpers } from './lib.mjs'

const version = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version
const fixture = shotPath('workflow-cylinder-r10.obj'), n = 160, obj = []
for (const z of [-5, 5]) for (let i = 0; i < n; i++) obj.push(`v ${10 * Math.cos(i * Math.PI * 2 / n)} ${10 * Math.sin(i * Math.PI * 2 / n)} ${z}`)
obj.push('v 0 0 -5', 'v 0 0 5')
for (let i = 0; i < n; i++) { const a = i + 1, b = (i + 1) % n + 1, c = a + n, d = b + n; obj.push(`f ${a} ${b} ${d}`, `f ${a} ${d} ${c}`, `f ${2 * n + 1} ${b} ${a}`, `f ${2 * n + 2} ${c} ${d}`) }
writeFileSync(fixture, obj.join('\n'))
const downloads = shotPath(`project-download-${Date.now()}`)
mkdirSync(downloads, { recursive: true })
const { browser, page, consoleErrors } = await launchApp({ width: 1500, height: 960, protocolTimeout: 600_000 })
const { re, built, kernelReady } = reverseHelpers(page)
const cdp = await browser.target().createCDPSession()
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true })
page.on('dialog', (dialog) => dialog.accept())
const must = (value, label) => { check(Boolean(value), label); if (!value) throw new Error(label) }
const fill = async (selector, value, end = 'Tab') => { const input = await page.$(selector); await input.focus(); await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await page.keyboard.type(String(value)); if (end) await page.keyboard.press(end) }
const at = (point) => re((p) => window.__re.sheet().sheetScreenPoint(p), point)
const pointClick = async (p) => { const pixel = await at(p); await page.mouse.click(pixel.x, pixel.y); await sleep(120) }
let summary = {}
try {
  must(await page.$eval('[data-test=app-version]', (el, expected) => el.textContent.trim() === `v${expected}`, version), `fresh runtime identifies version ${version}`)
  await loadScan(page, fixture)
  await openReverse(page)
  if (await page.$('[data-test=support-card] .sc-x')) await click(page, '[data-test=support-card] .sc-x')
  // Only setup uses the DEV hook; every brush/drawing/constraint/dimension/
  // extrude/save/edit action below goes through actual rendered controls.
  await re(() => {
    window.__re.store.getState().startSketch({ kind: 'world', axis: 'z', offset: 0 }, { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] })
    window.__re.store.setState((s) => ({ sketchDraft: { ...s.sketchDraft, placing: true } }))
  })
  await page.waitForSelector('[data-test=place-create]')
  if (await page.$eval('[data-test=tool-inspector]', (el) => el.dataset.mode === 'floating')) await click(page, '[data-test=toggle-inspector-dock]')
  await click(page, '[data-test=place-create]')
  await page.waitForSelector('[data-test=sketch-editor]'); await sleep(800)
  const referenceCount = await re(() => window.__re.store.getState().sketchDraft.sketch.referenceChains.reduce((sum, c) => sum + c.length, 0))
  must(referenceCount > 200, `actual section worker supplies persistent reference points (${referenceCount})`)
  await click(page, '[data-test=sketch-extract]')
  await click(page, '[data-test=sketch-fit-circle]')
  const path = Array.from({ length: 81 }, (_, i) => [10 * Math.cos(i * Math.PI * 2 / 80), 10 * Math.sin(i * Math.PI * 2 / 80)])
  const first = await at(path[0]); await page.mouse.move(first.x, first.y); await page.mouse.down()
  for (const p of path.slice(1)) { const pixel = await at(p); await page.mouse.move(pixel.x, pixel.y) }
  await sleep(200)
  const preview = await re(() => {
    const el = document.querySelector('[data-test=sketch-fit-brush-overlay]'), rgba = el.getContext('2d').getImageData(0, 0, el.width, el.height).data
    let orange = 0, green = 0
    for (let i = 0; i < rgba.length; i += 4) { if (rgba[i] > 220 && rgba[i + 1] > 100 && rgba[i + 1] < 190 && rgba[i + 2] < 30) orange++; if (rgba[i] < 30 && rgba[i + 1] > 110 && rgba[i + 2] > 25 && rgba[i + 2] < 100) green++ }
    return { orange, green }
  })
  must(preview.orange > 100 && preview.green > 100, `actual pointer stroke highlights section points and previews fitted circle (${JSON.stringify(preview)})`)
  await page.screenshot({ path: shotPath('01-circular-brush-circle-preview.png') })
  await page.mouse.up(); await sleep(300)
  const circle = await re(() => window.__re.store.getState().sketchDraft.sketch.entities.find((e) => e.kind === 'circle'))
  must(circle && circle.points.length > 200 && Math.abs(circle.r - 10) < 0.02, `release commits a real circle fitted to selected samples (r=${circle?.r})`)
  await click(page, '[data-test=sketch-fit-back]')
  const drawLine = async (a, b) => { await click(page, '[data-test=sketch-tool-line]'); await pointClick(a); await pointClick(b); await click(page, '[data-test=sketch-tool-select]') }
  const clearSelection = async () => { await click(page, '[data-test=sketch-tool-select]'); await pointClick([0, 8]) }
  // Deliberately sloped free lines, then real user-requested relations.
  await drawLine([-4, -3], [4, -1]); await clearSelection(); await pointClick([0, -2])
  await click(page, '[data-test=sketch-rel-horizontal]')
  await click(page, '[data-test=sketch-construction]')
  await drawLine([-4, -7], [4, -5]); await clearSelection(); await pointClick([0, -6]); await click(page, '[data-test=sketch-construction]')
  await clearSelection(); await pointClick([0, -2]); await pointClick([0, -6])
  must(await re(() => window.__re.store.getState().sketchDraft.selection.length === 2), 'graphical clicks select both construction lines together')
  await click(page, '[data-test=sketch-rel-parallel]')
  const constrained = await re(() => { const d = window.__re.store.getState().sketchDraft; return { horizontal: d.sketch.constraints.some((c) => c.kind === 'horizontal'), parallel: d.sketch.constraints.some((c) => c.kind === 'parallel'), construction: d.sketch.entities.filter((e) => e.construction).length, solved: d.report.ok } })
  must(constrained.horizontal && constrained.parallel && constrained.construction === 2 && constrained.solved, `actual solver accepts graphical horizontal/parallel constraints (${JSON.stringify(constrained)})`)
  await clearSelection(); await click(page, '[data-test=sketch-dimension]')
  await pointClick([Math.SQRT1_2 * 10, Math.SQRT1_2 * 10])
  const dimensionId = await re(() => window.__re.store.getState().sketchDraft.dimMade)
  must(dimensionId != null, 'graphical circle pick creates a driving diameter dimension')
  await pointClick([13, 8])
  const dimInput = `[data-test="flat-dimension-${dimensionId}"] input`
  await page.waitForSelector(dimInput)
  await fill(dimInput, 20, 'Enter'); await sleep(300)
  const dimensioned = await re(() => { const d = window.__re.store.getState().sketchDraft; return { dimensions: d.sketch.constraints.filter((c) => c.kind === 'diameter').map((c) => c.value), r: d.sketch.entities.find((e) => e.kind === 'circle').r, solved: d.report.ok, regions: d.found.length } })
  must(dimensioned.dimensions.includes(20) && Math.abs(dimensioned.r - 10) < 1e-5 && dimensioned.solved && dimensioned.regions === 1, `typed diameter drives circle geometry while construction lines leave one closed region (${JSON.stringify(dimensioned)})`)
  const labels = await page.$$eval('.viewport-label', (els) => els.map((el) => el.textContent))
  must(labels.some((text) => text.includes('20')) && labels.some((text) => text.includes('H')), 'dimension value and real constraint glyphs are visible on the graphical sketch')
  await page.screenshot({ path: shotPath('02-constraints-and-diameter.png') })
  await click(page, '[data-test=sketch-extrude]')
  await page.waitForSelector('[data-test=extrude-editor]')
  await fill('[data-test=extrude-to]', 12)
  await page.waitForSelector('[data-test=extrude-create]:not([disabled])', { timeout: 180_000 })
  await page.screenshot({ path: shotPath('03-extrude-preview.png') })
  await click(page, '[data-test=extrude-create]'); await built(); await sleep(600)
  const body = await re(() => { const s = window.__re.store.getState(), b = s.bodies[0], topology = window.__re.topology(b.id); return { id: b.id, volume: b.volume, closed: b.closed, faces: topology?.faces.length, edges: topology?.edges.length, kinds: s.features.map((f) => f.kind), buildError: s.buildError } })
  must(body.closed && Math.abs(body.volume - Math.PI * 100 * 12) < 0.2 && body.faces >= 3 && body.edges >= 3 && !body.buildError, `OCCT builds a closed solid with measured volume and real face/edge topology (${JSON.stringify(body)})`)
  await page.screenshot({ path: shotPath('04-closed-cylinder-body.png') })
  await fill('[data-test=project-name]', `Quick Scan ${version} full workflow`)
  await click(page, '[data-test=save-project]')
  let file = null
  for (let i = 0; i < 150 && !file; i++) { await sleep(200); const name = readdirSync(downloads).find((f) => f.endsWith('.scanruler')); if (name) file = join(downloads, name) }
  must(file, 'Save downloads a real .scanruler archive containing mesh, references, sketch and extrusion')
  await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('.panel')
  await (await page.$('[data-test=project-input]')).uploadFile(file)
  await page.waitForFunction(() => /Project opened/.test(document.querySelector('.strip')?.textContent ?? ''), { timeout: 120_000 })
  await kernelReady(); await built(); await sleep(700)
  const restored = await re(() => { const s = window.__re.store.getState(), sketch = s.features.find((f) => f.kind === 'sketch'), b = s.bodies[0], t = window.__re.topology(b.id); return { sketchId: sketch.id, kinds: s.features.map((f) => f.kind), volume: b.volume, closed: b.closed, faces: t?.faces.length, references: sketch.sketch.referenceChains.reduce((sum, c) => sum + c.length, 0), dimensions: sketch.sketch.constraints.filter((c) => c.kind === 'diameter').map((c) => c.value), horizontal: sketch.sketch.constraints.some((c) => c.kind === 'horizontal'), parallel: sketch.sketch.constraints.some((c) => c.kind === 'parallel') } })
  must(JSON.stringify(restored.kinds) === JSON.stringify(['sketch', 'extrude']) && restored.closed && Math.abs(restored.volume - body.volume) < 0.001 && restored.faces >= 3 && restored.references === referenceCount && restored.dimensions.includes(20) && restored.horizontal && restored.parallel, `archive reopen rebuilds topology and preserves all design data (${JSON.stringify(restored)})`)
  await page.screenshot({ path: shotPath('05-reopened-solid.png') })
  const row = `[data-test="explorer-history-feature-${restored.sketchId}"]`
  await page.waitForSelector(row); await page.click(row, { count: 2 }); await page.waitForSelector('[data-test=sketch-editor]'); await sleep(700)
  must(await re(() => { const d = window.__re.store.getState().sketchDraft; return d.sketch.constraints.some((c) => c.kind === 'diameter' && c.value === 20) && d.sketch.referenceChains.reduce((sum, c) => sum + c.length, 0) > 200 && d.report.ok }), 'double-clicking History reopens an editable solved sketch with its driving dimension and reference cloud')
  await page.screenshot({ path: shotPath('06-reopened-editable-sketch.png') })
  await click(page, '[data-test=sketch-cancel]'); await built()
  summary = { version, fixture, project: file, referenceCount, preview, constrained, dimensioned, body, restored }
  writeFileSync(shotPath('workflow-results.json'), JSON.stringify(summary, null, 2))
} catch (error) { check(false, error.stack ?? error.message) }
await finish(browser, consoleErrors)
