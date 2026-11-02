// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic sketch placement: real controls, display-unit conversion and cancellation.
import { launchApp, check, fail, finish, shotPath } from './e2e-lib.mjs'
import { readFileSync } from 'node:fs'
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const { browser, page, consoleErrors } = await launchApp({ agentDataOk: false })
try {
  await page.evaluate(async () => {
    const { useShell } = await import('/src/state/shellStore.ts')
    useShell.getState().setWorkspace('reverse')
  })
  await page.waitForFunction(() => !!window.__re)
  await page.evaluate(async () => {
    const { usePrefs } = await import('/src/state/prefsStore.ts')
    usePrefs.setState({ units: 'mm' })
    window.__re.store.getState().startSketch(
      { kind: 'world', axis: 'z', offset: 0 },
      { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] },
    )
    window.__re.store.setState(s => ({ sketchDraft: { ...s.sketchDraft, placing: true } }))
  })
  await page.waitForSelector('[data-test=place-offset-apply]')
  check(await page.evaluate(v => document.body.innerText.includes(`v${v}`), version), 'browser is running the current candidate version')
  check(await page.evaluate(() => {
    const a = document.querySelector('[data-test=place-offset]').getBoundingClientRect()
    const b = document.querySelector('[data-test=place-offset-apply]').getBoundingClientRect()
    return Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 2 && a.right <= b.left
  }), 'Offset and Apply sit beside each other')
  check(await page.$eval('[data-test=place-offset-apply]', el => el.disabled), 'Apply starts disabled at the current offset')
  const offset = () => page.evaluate(() => window.__re.store.getState().sketchDraft?.plane.offset)
  const enter = async (value, key) => {
    await page.click('[data-test=place-offset]', { clickCount: 3 })
    await page.keyboard.down('Control')
    await page.keyboard.press('a')
    await page.keyboard.up('Control')
    await page.keyboard.press('Backspace')
    if (value) await page.keyboard.type(value)
    if (key) await page.keyboard.press(key)
    else {
      const before = await offset()
      await page.keyboard.press('Tab')
      check(await offset() === before, 'leaving the offset field does not apply the pending value')
      await page.click('[data-test=place-offset-apply]')
      check(await page.$eval('[data-test=place-offset-apply]', el => el.disabled), 'Apply disables after accepting the pending offset')
    }
  }
  await enter('12.7')
  check(Math.abs(await offset() - 12.7) < 1e-9, 'Offset Apply moves the sketch plane to 12.7 mm')
  check(await page.evaluate(() => window.__re.store.getState().sketchDraft.frame.origin[2]) === 12.7, 'the actual frame moves with the offset')
  await page.evaluate(async () => (await import('/src/state/prefsStore.ts')).usePrefs.setState({ units: 'in' }))
  await page.waitForFunction(() => document.querySelector('[data-test=place-offset]')?.value === '0.5')
  check(await offset() === 12.7, 'switching display units preserves stored geometry')
  await enter('1')
  check(Math.abs(await offset() - 25.4) < 1e-9, 'Apply converts one inch to 25.4 internal millimetres')
  await enter('-0.5', 'Enter')
  check(Math.abs(await offset() + 12.7) < 1e-9, 'Enter accepts a negative offset in inches')
  await enter('', 'Enter')
  check(Math.abs(await offset() + 12.7) < 1e-9, 'empty Enter preserves the previous plane')
  check(await page.$eval('[data-test=place-offset]', el => el.value) === '-0.5', 'empty input restores the current offset')
  await page.screenshot({ path: shotPath('create-sketch-offset.png') })
  await page.click('[data-test=place-cancel]')
  check(await page.evaluate(() => window.__re.store.getState().sketchDraft === null), 'Cancel leaves no sketch draft')
} catch (error) {
  fail(error.stack ?? String(error))
} finally {
  await finish(browser, consoleErrors)
}
