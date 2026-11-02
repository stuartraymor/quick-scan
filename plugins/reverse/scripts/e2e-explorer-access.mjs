// SPDX-License-Identifier: AGPL-3.0-only
// Real model plus a persisted, editable sketch. Tree interactions use UI input;
// initial sketch geometry is seeded to keep this check independent of drawing.
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { launchApp, loadScan, check, finish, repoFile } from '../../../scripts/e2e-lib.mjs'
import { openReverse } from './lib.mjs'

const { browser, page, consoleErrors } = await launchApp({ protocolTimeout: 180000 })
const results = []
const record = (ok, label) => { check(ok, label); results.push({ ok: !!ok, label }) }
const out = resolve(process.env.VERIFY_OUT ?? '../explorer-access-evidence')
mkdirSync(out, { recursive: true })
try {
  await loadScan(page, repoFile(process.env.SCAN ?? 'public/reference-examples/basic_part.stl'))
  await openReverse(page)
  await page.evaluate(async () => {
    const { emptySketch, addRectangle } = await import('/plugins/reverse/core/sketch.ts')
    const s = window.__re.store.getState()
    s.startSketch({ kind: 'world', axis: 'z', offset: 0 }, { origin: [0,0,0], normal: [0,0,1], basisU: [1,0,0], basisV: [0,1,0] })
    const sketch = emptySketch(); addRectangle(sketch, [0,0], [12,8])
    s.setSketch(sketch); s.setSketchName('Tree verification sketch')
  })
  await page.click('[data-test="sketch-finish"]')
  await page.waitForFunction(() => window.__re.store.getState().features.some(f => f.kind === 'sketch'))
  const id = await page.evaluate(() => window.__re.store.getState().features.find(f => f.kind === 'sketch').id)
  const row = place => `[data-test="explorer-${place}-feature-${id}"]`
  record(await page.$(row('object')), 'created sketch is listed in Objects')
  record(await page.$(row('history')), 'same sketch is listed in History')
  await page.click('[data-test="workspace-elements"]')
  await page.waitForSelector(row('object'))
  record(await page.$(row('history')), 'both trees remain present outside CAD workspace')
  await page.click(row('object'))
  record(await page.evaluate(() => !window.__re.store.getState().sketchDraft), 'single-click selects without opening an editor')
  record(await page.$eval(row('history'), e => e.getAttribute('aria-pressed') === 'true'), 'selection synchronized between Objects and History')
  await page.click(row('object'), { button: 'right' })
  await page.waitForSelector('.explorer-feature-menu [role="menuitem"]')
  record(await page.$eval('.explorer-feature-menu', menu => {
    const r = menu.getBoundingClientRect()
    return menu.contains(document.elementFromPoint(r.right - 8, r.bottom - 8))
  }), 'context menu stays visible and clickable beyond the explorer boundary')
  await page.keyboard.press('Escape')
  record(await page.$('.explorer-feature-menu') === null, 'Escape dismisses context menu')
  await page.click(row('object'), { button: 'right' })
  await page.click('.explorer-feature-menu [role="menuitem"]')
  await page.waitForSelector('[data-test="sketch-editor"]')
  record(await page.evaluate(id => window.__re.store.getState().sketchDraft?.featureId === id, id), 'Objects Edit opens existing sketch, not a new feature')
  record(await page.evaluate(() => window.__re.store.getState().sketchDraft.sketch.entities.length === 4), 'original four editable curves retained')
  await page.click('[data-test="sketch-cancel"]')
  await page.click(row('history'), { button: 'right' })
  await page.click('.explorer-feature-menu [role="menuitem"]')
  await page.waitForSelector('[data-test="sketch-editor"]')
  record(await page.evaluate(id => window.__re.store.getState().sketchDraft?.featureId === id, id), 'History Edit opens the same sketch')
  await page.click('[data-test="sketch-cancel"]')
  await page.click(`[data-test="explorer-object-row-${id}"] .explorer-checkbox`)
  record(await page.$eval(`[data-test="explorer-history-row-${id}"] .explorer-checkbox`, e => !e.checked), 'Objects hide synchronizes History visibility')
  await page.click(`[data-test="explorer-history-row-${id}"] .explorer-checkbox`)
  record(await page.$eval(`[data-test="explorer-object-row-${id}"] .explorer-checkbox`, e => e.checked), 'History show synchronizes Objects visibility')
  await page.evaluate(async () => { const { useShell } = await import('/src/state/shellStore.ts'); useShell.getState().setExtractOpen(true) })
  record(await page.$eval(row('object'), e => e.disabled), 'tree editing is blocked while extraction holds a preview')
  await page.evaluate(async () => { const { useShell } = await import('/src/state/shellStore.ts'); useShell.getState().setExtractOpen(false) })
  await page.evaluate(id => window.__re.store.getState().setSuppressed([id], true), id)
  await page.waitForFunction(() => !window.__re.store.getState().building)
  await page.click(row('object'), { clickCount: 2 })
  record(await page.evaluate(() => !window.__re.store.getState().sketchDraft), 'double-click does not bypass the suppressed feature edit guard')
  await page.evaluate(id => window.__re.store.getState().setSuppressed([id], false), id)
  await page.waitForFunction(() => !window.__re.store.getState().building)
  const cdp = await page.createCDPSession()
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: out })
  await page.click('[data-test="save-project"]')
  for (let n=0;n<120 && !readdirSync(out).some(f=>f.endsWith('.scanruler'));n++) await new Promise(r=>setTimeout(r,250))
  record(readdirSync(out).some(f=>f.endsWith('.scanruler')), 'real-model sketch fixture saved for installed-app replay')
  await page.screenshot({ path: resolve(out, 'explorer-access.png') })
} catch (error) { record(false, error.stack) }
writeFileSync(resolve(out,'results.json'), JSON.stringify(results,null,2))
await finish(browser,consoleErrors)
