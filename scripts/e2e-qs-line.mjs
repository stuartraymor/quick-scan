// SPDX-License-Identifier: AGPL-3.0-only
// Marked-edge line fitting through the actual worker, UI and portable project.
import { writeFileSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, loadScan, check, fail, finish, shotPath, sleep } from './e2e-lib.mjs'

const lines = []
for (let x = 0; x <= 30; x++) for (const y of [-0.01, 0.01]) lines.push(`v ${x} ${y} 3`)
for (let x = 0; x < 30; x++) { const a = 2*x + 1; lines.push(`f ${a} ${a+2} ${a+3}`, `f ${a} ${a+3} ${a+1}`) }
const fixture = shotPath('edge-strip.obj')
writeFileSync(fixture, lines.join('\n'))
const downloadsRoot = shotPath('line-projects')
mkdirSync(downloadsRoot, { recursive: true })
const downloads = mkdtempSync(join(downloadsRoot, 'run-'))
const { browser, page, consoleErrors } = await launchApp({ agentDataOk: false })
try {
  const cdp = await browser.target().createCDPSession()
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads })
  await loadScan(page, fixture)
  await page.click('[data-test=ribbon-extract-primitives]')
  await page.click('[data-test=extract-select-all]')
  await page.waitForFunction(() => !document.querySelector('[data-test=extract-type-line]')?.disabled)
  await page.click('[data-test=extract-type-line]')
  await page.waitForSelector('[data-test=extract-preview]')
  const read = () => page.evaluate(() => {
    const s = window.__scanruler.measure.getState()
    return { draft: s.draft, elements: s.elements }
  })
  const preview = await read()
  check(preview.draft?.fit?.kind === 'line' && preview.elements.length === 0, 'Line produces a preview before creating geometry')
  const fit = preview.draft.fit
  check(Math.abs(fit.length - 30) < 1e-6 && Math.abs(fit.center[2] - 3) < 1e-6 && Math.abs(fit.dir[0] - 1) < 1e-6, 'the worker fits the known 30 mm edge at Z=3 mm')
  check(Math.abs(fit.sigma - 0.01) < 1e-6, 'fit error matches the synthetic edge scatter')
  await page.screenshot({ path: shotPath('line-preview.png') })
  await page.click('[data-test=extract-create]')
  check((await read()).elements.length === 1 && (await read()).elements[0].source.type === 'fitted', 'Create keeps a fitted line with its rebuild recipe')
  await page.click('[data-test=save-project]')
  let file
  for (let n = 0; n < 100 && !file; n++) { await sleep(100); const found = readdirSync(downloads).find(f => f.endsWith('.scanruler')); if (found) file = join(downloads, found) }
  if (!file) throw Error('The line project was not downloaded')
  check(true, 'the fitted line project saves')
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('.panel')
  await (await page.$('[data-test=project-input]')).uploadFile(file)
  await page.waitForFunction(() => /Project opened/.test(document.querySelector('.strip')?.textContent ?? ''), { timeout: 120_000 })
  await page.waitForFunction(() => window.__scanruler.measure.getState().elements[0]?.status === 'done')
  const restored = (await read()).elements[0]
  check(restored.fit.kind === 'line' && Math.abs(restored.fit.length - 30) < 1e-6 && Math.abs(restored.fit.sigma - 0.01) < 1e-6, 'the line refits correctly after reopening the project')
  check(Object.keys(restored.source.selection ?? {}).length === 62, 'all 62 marked vertices survive the project round trip')
} catch (error) { fail(error.stack ?? String(error)) }
finally { await finish(browser, consoleErrors) }
