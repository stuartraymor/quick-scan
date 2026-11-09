// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CylinderGeometry } from 'three'
import { launchApp, loadScan, MOD, OUT_DIR, shotPath } from '../../../scripts/e2e-lib.mjs'

const cylinder = new CylinderGeometry(20, 20, 40, 64, 12, true)
const vertices = cylinder.getAttribute('position'), indices = cylinder.index
let obj = ''
for (let i = 0; i < vertices.count; i++) obj += `v ${vertices.getX(i)} ${vertices.getY(i)} ${vertices.getZ(i)}\n`
for (let i = 0; i < indices.count; i += 3) obj += `f ${indices.getX(i) + 1} ${indices.getX(i + 1) + 1} ${indices.getX(i + 2) + 1}\n`
const file = join(OUT_DIR, 'wrap-cylinder.obj')
writeFileSync(file, obj)
const { browser, page, consoleErrors } = await launchApp()
const button = '[data-test=ribbon-wrap-surface]', dialog = '[data-test=wrap-surface-dialog]'
const tab = name => page.evaluate(name => Array.from(document.querySelectorAll('button')).find(e => e.textContent.trim() === name).click(), name)
try {
  await loadScan(page, file)
  await tab('Freeform')
  await page.waitForSelector(button)
  // Wait for CAD startup, then verify the selection prerequisite.
  await page.waitForFunction(() => /CAD kernel ready/.test(document.body.textContent), { timeout: 120000 })
  assert.equal(await page.$eval(button, e => e.disabled), true)
  await tab('Main')
  await page.click('[data-test=ribbon-edit-scan]')
  await page.waitForSelector('[data-test=edit-scan-select-all]')
  await page.click('[data-test=edit-scan-select-all]')
  await page.waitForFunction(() => /points selected/.test(document.querySelector('.qs-count')?.textContent ?? ''))
  await tab('Freeform')
  await page.waitForFunction(() => !document.querySelector('[data-test=ribbon-wrap-surface]').disabled)
  await page.click(button)
  await page.waitForSelector(dialog)
  assert.equal(await page.$eval('[aria-label=Details]', e => e.value), 'low')
  await page.keyboard.press('Escape')
  await page.waitForSelector(dialog, { hidden: true })
  assert.equal(await page.evaluate(() => document.querySelectorAll('[data-test=feature-row]').length), 0)
  await page.click(button)
  await page.waitForSelector(dialog)
  await page.select('[aria-label=Details]', 'medium')
  await page.screenshot({ path: shotPath('wrap-surface-dialog.png') })
  await page.click('[data-test=wrap-surface-ok]')
  await page.waitForSelector(dialog, { hidden: true, timeout: 120000 })
  assert.equal(await page.evaluate(() => document.querySelectorAll('[data-test=feature-row]').length), 1)
  assert.equal(await page.evaluate(() => document.querySelectorAll('[data-test=body-row]').length), 1)
  await page.mouse.move(1200, 700)
  await page.keyboard.down(MOD); await page.keyboard.press('KeyZ'); await page.keyboard.up(MOD)
  await page.waitForFunction(() => document.querySelectorAll('[data-test=feature-row]').length === 0)
  await page.keyboard.down(MOD); await page.keyboard.down('Shift'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Shift'); await page.keyboard.up(MOD)
  await page.waitForFunction(() => document.querySelectorAll('[data-test=body-row]').length === 1, { timeout: 120000 })
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark')
  assert.deepEqual(consoleErrors, [])
  await page.screenshot({ path: shotPath('wrap-surface-result.png') })
  console.log('PASS Wrap Surface selected through Edit Scan, selection survives workspace change, Low default, Cancel, Medium creation, undo/redo, dark theme')
} finally { await browser.close() }
