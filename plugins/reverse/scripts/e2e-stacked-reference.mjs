// SPDX-License-Identifier: AGPL-3.0-only
// Real worker cuts of a synthetic stepped mesh, one point-only sketch,
// actual project save/reopen and cancellation. No automatic primitive fit.
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { check, click, finish, launchApp, loadScan, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { openReverse, reverseHelpers } from './lib.mjs'

const fixture = shotPath('stacked-step.obj'), lines = [], rings = [{ z: -10, x: 10, y: 5 }, { z: 0, x: 10, y: 5 }, { z: 0, x: 6, y: 3 }, { z: 10, x: 6, y: 3 }], perSide = 20, n = 4 * perSide
for (const { z, x, y } of rings) {
  const corners = [[-x, -y], [x, -y], [x, y], [-x, y]]
  corners.forEach((a, j) => { const b = corners[(j + 1) % 4]; for (let i = 0; i < perSide; i++) { const u = i / perSide; lines.push(`v ${a[0] * (1 - u) + b[0] * u} ${a[1] * (1 - u) + b[1] * u} ${z}`) } })
}
for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < n; i++) { const a = r * n + i + 1, b = r * n + (i + 1) % n + 1, c = a + n, d = b + n; lines.push(`f ${a} ${b} ${d}`, `f ${a} ${d} ${c}`) }
writeFileSync(fixture, lines.join('\n'))
const { browser, page, consoleErrors } = await launchApp({ width: 1500, height: 960, protocolTimeout: 600_000 })
const { re } = reverseHelpers(page)
const downloadDir = shotPath(`stacked-project-download-${Date.now()}`)
mkdirSync(downloadDir, { recursive: true })
const cdp = await browser.target().createCDPSession()
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir, eventsEnabled: true })
page.on('dialog', (dialog) => dialog.accept())
try {
  await loadScan(page, fixture)
  await openReverse(page)
  if (await page.$('[data-test=support-card] .sc-x')) await click(page, '[data-test=support-card] .sc-x')
  const start = () => re(() => {
    window.__re.store.getState().startSketch({ kind: 'world', axis: 'z', offset: -8 }, { origin: [0, 0, -8], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] })
    window.__re.store.setState((s) => ({ sketchDraft: { ...s.sketchDraft, placing: true } }))
  })
  const waitDone = () => page.waitForFunction(() => !document.querySelector('[data-test=place-working]'), { timeout: 120_000 })
  await start(); await page.waitForSelector('[data-test=place-stacked]')
  await click(page, '[data-test=place-stacked]')
  await page.waitForFunction(() => !document.querySelector('[data-test=place-working]') && window.__re.store.getState().sketchDraft?.sketch.referenceChains !== undefined, { timeout: 120_000 })
  const initial = await re(() => { const s = window.__re.store.getState(), d = s.sketchDraft; return { features: s.features.length, entities: d.sketch.entities.length, chains: d.sketch.referenceChains?.length, points: d.sketch.referenceChains?.reduce((sum, c) => sum + c.length, 0), history: d.history.length } })
  check(initial.features === 0 && initial.entities === 0 && initial.chains === 10, `default 10 real cuts, from the sketch plane to the far side, collect into one draft cloud without geometry/features (${JSON.stringify(initial)})`)
  // The upper plane: shown in the panel from the sketch plane, its blue arrow
  // and slab in the view; typed, the cuts follow live (no Apply).
  const upperShown = await page.$eval('[data-test=place-stack-upper]', (e) => Number(e.value))
  check(Math.abs(upperShown - 17.64) < 0.01, `the upper plane starts just inside the far side of the scan, 17.64 mm from the sketch plane (${upperShown})`)
  await page.screenshot({ path: shotPath('stacked-planes-in-view.png') })
  const upper = await page.$('[data-test=place-stack-upper]')
  const retype = async (text) => { await upper.focus(); await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await upper.type(text) }
  await retype('6')
  await page.waitForFunction(() => { const c = window.__re.store.getState().sketchDraft?.sketch.referenceChains; return !document.querySelector('[data-test=place-working]') && c?.length === 10 && c.every((ch) => Math.max(...ch.map((p) => Math.abs(p[0]))) > 9.9) }, { timeout: 120_000 })
  check(true, 'typing the upper plane 6 mm above re-cuts live: all 10 cuts now on the lower profile (−8 to −2 mm)')
  await retype('17.64'); await page.keyboard.press('Tab')
  await page.waitForFunction(() => { const c = window.__re.store.getState().sketchDraft?.sketch.referenceChains; return !document.querySelector('[data-test=place-working]') && c?.length === 10 && c.some((ch) => Math.max(...ch.map((p) => Math.abs(p[0]))) < 6.1) }, { timeout: 120_000 })
  const input = await page.$('[data-test=place-stacked-count]'); await input.focus(); await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await input.type('4')
  await click(page, '[data-test=place-stacked-apply]'); await page.waitForFunction(() => !document.querySelector('[data-test=place-working]') && window.__re.store.getState().sketchDraft?.sketch.referenceChains?.length === 4, { timeout: 120_000 })
  const applied = await re(() => { const s = window.__re.store.getState(), d = s.sketchDraft; return { features: s.features.length, entities: d.sketch.entities.length, chains: d.sketch.referenceChains.length, history: d.history.length, x: d.sketch.referenceChains.map((c) => Math.max(...c.map((p) => Math.abs(p[0])))) } })
  check(applied.features === 0 && applied.entities === 0 && applied.chains === 4 && applied.history === initial.history, `Apply and the live re-cuts update the cloud without sketch commits or undo steps (${JSON.stringify(applied)})`)
  check(applied.x.some((x) => Math.abs(x - 10) < 0.001) && applied.x.some((x) => Math.abs(x - 6) < 0.001), 'actual stepped lower and upper profiles both project onto the reference plane')
  await page.screenshot({ path: shotPath('stacked-apply-one-cloud.png') })
  await click(page, '[data-test=place-create]')
  await page.waitForSelector('[data-test=sketch-editor]')
  await sleep(800)
  check(await re(() => window.__re.store.getState().features.length === 0 && window.__re.store.getState().sketchDraft.sketch.entities.length === 0 && window.__re.store.getState().sketchDraft.sketch.referenceChains.length === 4), 'Create opens the same point-only sketch editor without auto-fitting')
  await page.screenshot({ path: shotPath('stacked-editor-reference-points.png') })
  await click(page, '[data-test=sketch-finish]')
  check(await re(() => window.__re.store.getState().features.length === 1 && window.__re.store.getState().features[0].kind === 'sketch' && window.__re.store.getState().features[0].sketch.entities.length === 0), 'OK commits exactly one point-only reference sketch feature')
  await page.waitForFunction(() => !window.__re.store.getState().building, { timeout: 120_000 })
  await click(page, '[data-test=save-project]')
  let saved = null
  for (let i = 0; i < 150 && !saved; i++) { await sleep(200); const file = readdirSync(downloadDir).find((name) => name.endsWith('.scanruler')); if (file) saved = join(downloadDir, file) }
  check(Boolean(saved), 'a real project archive containing the reference cloud was saved')
  if (saved) {
    await re(() => window.__re.store.getState().reset())
    await (await page.$('[data-test=project-input]')).uploadFile(saved)
    await page.waitForFunction(() => window.__re?.store.getState().features.length === 1, { timeout: 120_000 })
    await re(() => window.__re.store.getState().editSketch(window.__re.store.getState().features[0].id))
    await page.waitForSelector('[data-test=sketch-editor]')
    check(await re(() => window.__re.store.getState().sketchDraft.sketch.referenceChains.length === 4), 'saved reference data survives archive reopen and sketch editing')
    await click(page, '[data-test=sketch-reference-clear]')
    await sleep(250)
    check(await re(() => window.__re.store.getState().sketchDraft.sketch.referenceChains.length === 0 && window.__re.store.getState().chainCount === 0), 'Clear is authoritative and does not recut points from the loaded scan')
    await re(() => window.__re.store.getState().discardSketch())
  }
  await start(); await page.waitForSelector('[data-test=place-ignore-scan]')
  await click(page, '[data-test=place-ignore-scan]'); await click(page, '[data-test=place-create]')
  await page.waitForSelector('[data-test=sketch-editor]')
  check(await re(() => window.__re.store.getState().sketchDraft.sketch.referenceChains.length === 0 && window.__re.store.getState().sketchModelShown), 'Ignore scan suppresses reference extraction without hiding the model')
  await re(() => window.__re.store.getState().discardSketch())
  await start(); await page.waitForSelector('[data-test=place-hide-scan]')
  if (await page.$eval('[data-test=place-ignore-scan]', (input) => input.checked)) await click(page, '[data-test=place-ignore-scan]')
  await click(page, '[data-test=place-hide-scan]'); await click(page, '[data-test=place-create]')
  await page.waitForSelector('[data-test=sketch-editor]')
  check(await re(() => window.__re.store.getState().sketchDraft.sketch.referenceChains.length > 0 && !window.__re.store.getState().sketchModelShown), 'Hide scan changes visibility while keeping extracted reference data')
  await re(() => { window.__re.store.getState().discardSketch(); window.__re.store.getState().setSketchModelShown(true) })
  await start(); await page.waitForSelector('[data-test=place-create-stay]')
  await click(page, '[data-test=place-create-stay]')
  await page.waitForFunction(() => window.__re.store.getState().features.length === 2 && window.__re.store.getState().sketchDraft?.placing, { timeout: 120_000 })
  check(await re(() => window.__re.store.getState().features[1].sketch.entities.length === 0 && window.__re.store.getState().features[1].sketch.referenceChains.length > 0), 'Create & Stay adds one reference-only feature and stays in plane placement')
  await re(() => window.__re.store.getState().discardSketch())
  await start(); await click(page, '[data-test=place-mode-revolved]')
  check(await page.$eval('[data-test=place-stacked]', (input) => input.disabled), 'unverified radial stacked projection remains explicitly unavailable')
  await click(page, '[data-test=place-cancel]')
  await start(); await page.waitForSelector('[data-test=place-stacked]')
  await click(page, '[data-test=place-stacked]')
  await click(page, '[data-test=place-cancel]')
  await sleep(500)
  check(await re(() => !window.__re.store.getState().sketchDraft && window.__re.store.getState().features.length === 2), 'Cancel drops in-flight collection without committing partial or extra features')
} catch (error) { check(false, error.stack ?? error.message) }
await finish(browser, consoleErrors)
