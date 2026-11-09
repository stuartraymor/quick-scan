// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SphereGeometry } from 'three'
import { launchApp, loadScan, MOD, OUT_DIR, shotPath } from '../../../scripts/e2e-lib.mjs'

const sphere = new SphereGeometry(20, 32, 24), vertices = sphere.getAttribute('position'), indices = sphere.index
let obj = ''
for (let i = 0; i < vertices.count; i++) obj += `v ${vertices.getX(i)} ${vertices.getY(i)} ${vertices.getZ(i)}\n`
for (let i = 0; i < indices.count; i += 3) obj += `f ${indices.getX(i) + 1} ${indices.getX(i + 1) + 1} ${indices.getX(i + 2) + 1}\n`
const file = join(OUT_DIR, 'auto-sphere.obj')
writeFileSync(file, obj)
const { browser, page, consoleErrors } = await launchApp()
const button = '[data-test=ribbon-auto-freeform]', dialog = '[data-test=auto-freeform-dialog]'
const features = () => page.evaluate(() => document.querySelectorAll('[data-test=feature-row]').length)
try {
  await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(e => e.textContent.trim() === 'Freeform').click())
  assert.equal(await page.$eval(button, e => e.disabled), true)
  await loadScan(page, file)
  await page.click(button)
  await page.waitForSelector(dialog, { timeout: 120000 })
  assert.equal(await page.$eval('[aria-label="Target Quads Count"]', e => e.value), 'medium')
  await page.keyboard.press('Escape')
  await page.waitForSelector(dialog, { hidden: true })
  assert.equal(await features(), 0)
  await page.click(button)
  await page.waitForSelector(dialog)
  await page.select('[aria-label="Target Quads Count"]', 'custom')
  await page.$eval('[aria-label="Quads"]', e => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(e, '99'); e.dispatchEvent(new Event('input', { bubbles: true })) })
  await page.waitForFunction(() => document.querySelector('[data-test=auto-freeform-ok]').disabled)
  await page.$eval('[aria-label="Quads"]', e => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(e, '100'); e.dispatchEvent(new Event('input', { bubbles: true })) })
  await page.select('[aria-label="Symmetry"]', 'oyz')
  await page.screenshot({ path: shotPath('auto-freeform-dialog.png') })
  await page.click('[data-test=auto-freeform-ok]')
  await page.waitForSelector(dialog, { hidden: true, timeout: 180000 })
  assert.equal(await features(), 1)
  assert.equal(await page.evaluate(() => document.querySelectorAll('[data-test=body-row]').length), 1)
  await page.mouse.move(1200, 700)
  await page.keyboard.down(MOD); await page.keyboard.press('KeyZ'); await page.keyboard.up(MOD)
  await page.waitForFunction(() => document.querySelectorAll('[data-test=feature-row]').length === 0)
  await page.keyboard.down(MOD); await page.keyboard.down('Shift'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Shift'); await page.keyboard.up(MOD)
  await page.waitForFunction(() => document.querySelectorAll('[data-test=body-row]').length === 1, { timeout: 120000 })
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark')
  assert.deepEqual(consoleErrors, [])
  await page.screenshot({ path: shotPath('auto-freeform-result.png') })
  console.log('PASS Auto Freeform scan prerequisite, cancel, custom validation, Basic generation with symmetry, undo/redo, dark theme')
} finally { await browser.close() }
