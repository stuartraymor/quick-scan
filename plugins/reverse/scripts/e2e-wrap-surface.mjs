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
  // Clicking the ribbon through the backdrop must not open another command.
  const hiddenButton = await page.$eval('[data-test=ribbon-from-quad-obj-]', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await page.$eval('[data-test=ribbon-from-quad-obj-]', e => {
    window.__backgroundCommandClicks = 0
    e.addEventListener('click', () => { window.__backgroundCommandClicks++ }, { once: true })
  })
  await page.mouse.click(hiddenButton.x, hiddenButton.y)
  assert.equal(await page.evaluate(() => window.__backgroundCommandClicks), 0)
  const cameraBefore = await page.evaluate(() => window.__scanruler.scene().viewport.camera.quaternion.toArray())
  await page.mouse.move(1000, 500)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(1100, 550, { steps: 12 })
  await page.mouse.up({ button: 'middle' })
  assert.notDeepEqual(await page.evaluate(() => window.__scanruler.scene().viewport.camera.quaternion.toArray()), cameraBefore)
  const zoomBefore = await page.evaluate(() => window.__scanruler.scene().viewport.camera.zoom)
  await page.mouse.wheel({ deltaY: 200 })
  await page.waitForFunction(z => window.__scanruler.scene().viewport.camera.zoom !== z, {}, zoomBefore)
  assert.ok(await page.$(dialog))
  await page.keyboard.press('Escape')
  await page.waitForSelector(dialog, { hidden: true })
  assert.equal(await page.evaluate(() => document.querySelectorAll('[data-test=feature-row]').length), 0)
  await page.click(button)
  await page.waitForSelector(dialog)
  await page.select('[aria-label=Details]', 'medium')
  const undoBefore = await page.$eval('[data-test=undo]', e => e.title)
  await page.click('[data-test=wrap-surface-preview]')
  await page.waitForSelector('[data-test=wrap-surface-preview-ready]', { timeout: 120000 })
  assert.equal(await page.evaluate(() => window.__re.store.getState().features.length), 0)
  assert.ok(await page.evaluate(() => window.__re.reScene().bodyPreview?.geometry.attributes.position.count > 0))
  assert.equal(await page.$eval('[data-test=undo]', e => e.title), undoBefore)
  await page.screenshot({ path: shotPath('wrap-surface-preview.png') })
  await page.keyboard.press('Escape')
  await page.waitForSelector(dialog, { hidden: true })
  assert.equal(await page.evaluate(() => window.__re.reScene().bodyPreview), null)
  await page.click(button)
  await page.waitForSelector(dialog)
  await page.click('[data-test=wrap-surface-preview]')
  await page.waitForSelector('[data-test=wrap-surface-preview-ready]', { timeout: 120000 })
  await page.select('[aria-label=Details]', 'medium')
  await page.waitForSelector('[data-test=wrap-surface-preview-ready]', { hidden: true })
  assert.equal(await page.evaluate(() => window.__re.reScene().bodyPreview), null)
  await page.click('[data-test=wrap-surface-preview]')
  await page.waitForSelector('[data-test=wrap-surface-preview-ready]', { timeout: 120000 })
  await page.screenshot({ path: shotPath('wrap-surface-dialog.png') })
  await page.click('[data-test=wrap-surface-ok]')
  await page.waitForSelector(dialog, { hidden: true, timeout: 120000 })
  assert.equal(await page.evaluate(() => document.querySelectorAll('[data-test=feature-row]').length), 1)
  assert.equal(await page.evaluate(() => document.querySelectorAll('[data-test=body-row]').length), 1)
  assert.equal(await page.evaluate(() => window.__re.reScene().bodyPreview), null)
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
