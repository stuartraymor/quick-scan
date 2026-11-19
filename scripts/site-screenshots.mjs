// SPDX-License-Identifier: AGPL-3.0-only
// Refreshes the website/README screenshots from the bundled sample scan only
// (never a user's or third-party model).
// Prereqs: a dev server (npx vite --port 5197), Chrome.
//   APP_URL=http://localhost:5197/ node scripts/site-screenshots.mjs
import { launchApp, click } from './e2e-lib.mjs'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const out = new URL('../site/img/', import.meta.url)
const { browser, page } = await launchApp({ width: 1600, height: 960 })
try {
  await page.waitForSelector('[data-test=start-pane]', { timeout: 60000 })
  await click(page, '[data-test=workspace-elements]')
  await click(page, '[data-test=start-sample]')
  await page.waitForFunction(() => /fridgeBracket/.test(document.body.textContent ?? ''), { timeout: 60000 })
  await sleep(4000)
  await page.screenshot({ path: new URL('quick-scan-main.png', out) })
  await click(page, '[data-test=workspace-reverse]')
  await sleep(4000)
  await page.screenshot({ path: new URL('quick-scan-cad.png', out) })
} finally { await browser.close() }
