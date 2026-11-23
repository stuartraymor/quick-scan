// SPDX-License-Identifier: AGPL-3.0-only
// End-to-end check of 1.2.12: what the CAD workspace says by the cursor and
// about a rolled-back model, with the CAD tools panel shut — the panel the
// QUICKSURFACE-style floating dialog closes to its title key.
//
// - A face clicked with the panel shut: its card (Flat face, area, normal)
//   and its keys stand by the cursor, on screen, in the dark theme's colours.
//   Before 1.2.12 they lived inside the shut panel (display: none) and said
//   nothing.
// - The agent's Note key on that card opens the note box by the cursor, on
//   screen, the panel still shut (the AI feature's own card).
// - History's Previous step rolls the model back: the ribbon's modelling tabs
//   go inert, and a strip under the ribbon says why, with To End of Model,
//   which builds the whole model again and takes the strip away.
// - The theme stays dark and the AI tab stays on the ribbon throughout.
//
// Prereqs: dev server running (npm run dev), Chrome installed.
//   node plugins/reverse/scripts/e2e-closed-panel.mjs
// Env: CHROME, APP_URL, SHOT_DIR.
import { check, finish, launchApp, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { openReverse, reverseHelpers } from './lib.mjs'

const { browser, page, consoleErrors } = await launchApp({ width: 1600, height: 1000, protocolTimeout: 600_000 })
const { re, built, screen } = reverseHelpers(page)
const XY = (z) => ({ origin: [0, 0, z], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] })

/** Whether an element is on screen where it is drawn: its middle, hit-tested. */
const seen = (sel) =>
  page.$eval(sel, (el) => {
    const r = el.getBoundingClientRect()
    const h = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 8))
    return r.width > 0 && r.height > 0 && Boolean(h && (h === el || el.contains(h)))
  }).catch(() => false)
const themeAndAi = () => page.evaluate(() => ({ theme: document.documentElement.dataset.theme ?? null, ai: Boolean(document.querySelector('[data-test=ribbon-tab-ai]')) }))

await openReverse(page)
const start = await themeAndAi()
check(start.theme === 'dark' && start.ai, `Quick Scan's dark theme and its AI tab (${JSON.stringify(start)})`)

// ---- a block, 40 × 20 × 10, and a second sketch for History to step back over -----------
await re((frame) => {
  const s = () => window.__re.store.getState()
  s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, frame)
  s().setSketchTool('rectangle')
  s().sketchClick([0, 0], 0.01, false, { off: true })
  s().sketchClick([40, 20], 0.01, false, { off: true })
  const id = s().commitSketch()
  s().startExtrude(id)
  if (s().extrudeDraft.regions.length === 0) s().pickAllDraftRegions()
  s().setExtrude({ extent: { kind: 'distance', from: 0, to: 10 } })
  s().commitExtrude()
}, XY(0))
await built()
await re((frame) => {
  const s = () => window.__re.store.getState()
  s().startSketch({ kind: 'world', axis: 'z', offset: 10 }, frame)
  s().setSketchTool('rectangle')
  s().sketchClick([5, 5], 0.01, false, { off: true })
  s().sketchClick([15, 15], 0.01, false, { off: true })
  s().commitSketch()
}, XY(10))
await page.waitForFunction(() => !window.__re.store.getState().building && window.__re.store.getState().features.length === 3, { timeout: 60_000 })
await re(() => window.__re.scene().frameAll())
await sleep(800)

// ---- the panel shut --------------------------------------------------------------------------
if (await page.$('[data-test=tool-inspector]:not([hidden])')) await page.click('[data-test=hide-tool-inspector]')
await sleep(300)
check((await page.$('[data-test=tool-inspector]:not([hidden])')) === null && (await page.$('[data-test=show-tool-inspector]')) !== null, 'the CAD tools panel is shut to its key')

// ---- a face clicked: its card by the cursor -----------------------------------------------
{
  const [x, y] = await screen([30, 10, 10])
  await page.mouse.move(x + 6, y)
  await sleep(150)
  await page.mouse.move(x, y)
  await sleep(250)
  await page.mouse.click(x, y)
  await sleep(400)
}
const card = await page.evaluate(() => {
  const el = document.querySelector('[data-test=context-chips]')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { text: el.innerText.replace(/\s+/g, ' ').trim(), box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], bg: getComputedStyle(el).backgroundColor, inPanel: Boolean(el.closest('[data-test=tool-inspector]')) }
})
check(card !== null && (await seen('[data-test=chip-info]')) && /Flat face/.test(card.text) && /Area 800\.00 mm²/.test(card.text) && /Normal 0\.000, 0\.000, 1\.000/.test(card.text) && !card.inPanel, `with the panel shut, a face's card stands by the cursor, on screen (${JSON.stringify(card)})`)
// rgba(37, 40, 44, 0.96): the dark panels' glass, not the light one's.
check(/^rgba\(37, 40, 44, 0\.96\)$/.test(card?.bg ?? ''), `the card wears the dark panels' colours (${card?.bg})`)
check(await seen('[data-test=chip-shell]'), 'and its keys are on screen: Shell')
await page.screenshot({ path: shotPath('closed-panel-face-card.png') })

// ---- the agent's Note key: its box by the cursor, the panel still shut ----------------------
await page.evaluate(async () => (await import('/src/state/prefsStore.ts')).usePrefs.setState({ agentLink: true }))
await sleep(300)
await page.waitForSelector('[data-test=chip-note]', { timeout: 5000 }).catch(() => {})
check(await seen('[data-test=chip-note]'), 'with the agent connection on, the card offers Note, on screen')
await page.click('[data-test=chip-note]').catch(() => {})
await page.waitForSelector('[data-test=note-card]', { timeout: 5000 }).catch(() => {})
check((await seen('[data-test=note-card]')) && (await seen('[data-test=note-text]')), 'Note opens its box by the cursor, on screen, with the panel shut')
await page.keyboard.type('Round this edge R2')
await page.screenshot({ path: shotPath('closed-panel-note-card.png') })
await page.click('[data-test=note-keep]').catch(() => {})
await sleep(300)
const kept = await page.evaluate(async () => (await import('/plugins/reverse/state/noteStore.ts')).useNotes.getState().notes.map((n) => n.text))
check(kept.includes('Round this edge R2') && (await page.$('[data-test=note-card]')) === null, `the note is kept and its box shuts (${JSON.stringify(kept)})`)
await page.evaluate(async () => (await import('/src/state/prefsStore.ts')).usePrefs.setState({ agentLink: false }))
await page.keyboard.press('Escape')
await sleep(200)

// ---- History's Previous: rolled back, and said so ---------------------------------------------
await page.click('[aria-label="Previous model step"]')
await page.waitForFunction(async () => (await import('/src/state/documentOrderStore.ts')).useDocumentOrder.getState().rollbackAt !== null && !window.__re.store.getState().building, { timeout: 60_000 })
await sleep(400)
const rolled = await page.evaluate(() => ({ ribbonInert: Boolean(document.querySelector('.desktop-ribbon')?.inert), strip: document.querySelector('[data-test=model-rolled-bar]')?.textContent ?? null, features: window.__re.store.getState().features.length }))
check(rolled.ribbonInert && /The model is rolled back/.test(rolled.strip ?? '') && (await seen('[data-test=model-rolled-to-end]')), `rolled back, the ribbon's tools are off and a strip under it says why, with To End of Model on screen (${JSON.stringify(rolled)})`)
await page.screenshot({ path: shotPath('closed-panel-rolled-strip.png') })
await page.click('[data-test=model-rolled-to-end]')
await page.waitForFunction(async () => (await import('/src/state/documentOrderStore.ts')).useDocumentOrder.getState().rollbackAt === null && !window.__re.store.getState().building && window.__re.store.getState().features.length === 3, { timeout: 60_000 })
await sleep(300)
const back = await page.evaluate(() => ({ ribbonInert: Boolean(document.querySelector('.desktop-ribbon')?.inert), strip: document.querySelector('[data-test=model-rolled-bar]') !== null, features: window.__re.store.getState().features.length, bodies: window.__re.store.getState().bodies.length }))
check(!back.ribbonInert && !back.strip && back.features === 3 && back.bodies === 1, `To End of Model builds the whole model, the tools come back and the strip goes (${JSON.stringify(back)})`)

const end = await themeAndAi()
check(end.theme === 'dark' && end.ai, `still the dark theme, with the AI tab (${JSON.stringify(end)})`)
// The Note key needs only the agent switch on: no agent bridge runs here, so
// the app's attempt to reach it on 127.0.0.1:7317 is refused. That one
// refusal is expected; every other console error still fails the run.
const bridge = /WebSocket connection to 'ws:\/\/127\.0\.0\.1:7317\/' failed: .*ERR_CONNECTION_REFUSED/
for (let i = consoleErrors.length - 1; i >= 0; i--) if (bridge.test(consoleErrors[i])) consoleErrors.splice(i, 1)
await finish(browser, consoleErrors)
