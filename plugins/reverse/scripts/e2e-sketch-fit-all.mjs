// SPDX-License-Identifier: AGPL-3.0-only
// "Fit all chains" on a real scan's section, in the flow a person takes:
// Create Sketch on a plane through the part, open "Sketch settings and
// additional tools", press Fit all chains. The section's chains become lines
// and arcs with their slice points behind them; Undo takes them back.
// Usage: SCAN=<relative path to basic_part.stl> node e2e-sketch-fit-all.mjs
import { check, click, finish, launchApp, loadScan, repoFile, requireFixture, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { openReverse, reverseHelpers } from './lib.mjs'

const SCAN = repoFile(process.env.SCAN ?? '../../test-models/basic_part/basic_part.stl')
requireFixture(SCAN)
const { browser, page, consoleErrors } = await launchApp({ width: 1500, height: 960, protocolTimeout: 600_000 })
const { re } = reverseHelpers(page)
const info = () => re(() => { const s = window.__re.store.getState(), d = s.sketchDraft; return { status: s.chainsStatus, entities: d?.sketch.entities.length ?? 0, kinds: [...new Set(d?.sketch.entities.map((e) => e.kind))], withPoints: d?.sketch.entities.filter((e) => e.points?.length > 0).length ?? 0, reference: d?.sketch.referenceChains?.reduce((n, c) => n + c.length, 0) ?? 0, fitted: Object.keys(d?.fitted ?? {}).length, error: d?.error ?? null, history: d?.history.length ?? 0 } })
try {
  await loadScan(page, SCAN, { timeout: 240_000 })
  await openReverse(page)
  if (await page.$('[data-test=support-card] .sc-x')) await click(page, '[data-test=support-card] .sc-x')
  await re(() => {
    const c = window.__re.measure.getState().modelCenter
    window.__re.store.getState().startSketch({ kind: 'world', axis: 'z', offset: c[2] }, { origin: [c[0], c[1], c[2]], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] })
    window.__re.store.setState((s) => ({ sketchDraft: { ...s.sketchDraft, placing: true } }))
  })
  await page.waitForSelector('[data-test=place-create]')
  if (await page.$eval('[data-test=tool-inspector]', (el) => el.dataset.mode === 'floating')) await click(page, '[data-test=toggle-inspector-dock]')
  await click(page, '[data-test=place-create]')
  await page.waitForSelector('[data-test=sketch-editor]'); await sleep(1500)
  await page.waitForFunction(() => window.__re.store.getState().chainsStatus !== 'cutting', { timeout: 120_000 })
  const before = await info()
  check(before.reference > 100 && before.entities === 0, `the sketch opens with the section's reference points and nothing drawn (${JSON.stringify(before)})`)
  // The key is in the folded "Sketch settings and additional tools".
  await page.evaluate(() => { const d = document.querySelector('[data-test=sketch-fit-all]')?.closest('details'); if (d && !d.open) d.querySelector('summary').click() })
  await sleep(300)
  const key = await page.$eval('[data-test=sketch-fit-all]', (el) => { el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { disabled: el.disabled, x: r.left + r.width / 2, y: r.top + r.height / 2 } })
  check(!key.disabled, 'Fit all chains is offered')
  await page.mouse.click(key.x, key.y); await sleep(2500)
  const after = await info()
  await page.screenshot({ path: shotPath('01-fit-all.png') })
  check(after.entities > 0 && after.withPoints === after.entities && after.history === before.history + 1, `one press fits the chains into pieces that keep their slice points, as one step (${JSON.stringify(after)})`)
  await page.evaluate(() => document.activeElement?.blur())
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control'); await sleep(500)
  const undone = await info()
  check(undone.entities === 0, `Undo takes the fitted pieces back (${undone.entities})`)
} catch (error) { check(false, error.stack ?? error.message) }
await finish(browser, consoleErrors)
