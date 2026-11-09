// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, loadScan, MOD, OUT_DIR, shotPath } from '../../../scripts/e2e-lib.mjs'

let obj = ''
for (let j = 0; j <= 40; j++) for (let i = 0; i <= 50; i++) obj += `v ${i} ${j} 0\n`
for (let j = 0; j < 40; j++) for (let i = 0; i < 50; i++) {
  const n = j * 51 + i + 1
  obj += `f ${n} ${n + 1} ${n + 52}\nf ${n} ${n + 52} ${n + 51}\n`
}
const file = join(OUT_DIR, 'sketch-plane.obj')
writeFileSync(file, obj)
const { browser, page, consoleErrors } = await launchApp()
const button = '[data-test=ribbon-from-3d-sketch]', dialog = '[data-test=freeform-sketch-dialog]'
const count = () => page.evaluate(() => document.querySelectorAll('[data-test=feature-row]').length)
const setResolution = value => page.$eval('[aria-label=Resolution]', (e, value) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, value)
  e.dispatchEvent(new Event('input', { bubbles: true }))
}, value)
try {
  await loadScan(page, file)
  await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(e => e.textContent.trim() === 'Freeform').click())
  await page.waitForFunction(() => /CAD kernel ready/.test(document.body.textContent), { timeout: 120000 })
  assert.equal(await page.$eval(button, e => e.disabled), true)
  // Fixture setup through the same command used by MCP; UI operation follows.
  await page.evaluate(async () => {
    const { runCommand } = await import('/src/commands/registry.ts')
    const corners = [[10, 10, 0], [40, 10, 0], [40, 30, 0], [10, 30, 0]]
    await runCommand('reverse.network.create', { name: 'Loop', curves: corners.map((p, i) => ({ points: [p, corners[(i + 1) % 4]] })), fill: 'all' })
  })
  await page.waitForFunction(() => !document.querySelector('[data-test=ribbon-from-3d-sketch]').disabled)
  const before = await count()
  await page.click(button)
  await page.waitForSelector(dialog)
  assert.equal(await page.$eval('[aria-label=Resolution]', e => e.value), '1')
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
  assert.equal(await count(), before)
  await page.click(button)
  await page.waitForSelector(dialog)
  await setResolution('0')
  await page.waitForFunction(() => document.querySelector('[data-test=freeform-sketch-ok]').disabled)
  await setResolution('2')
  const undoBefore = await page.$eval('[data-test=undo]', e => e.title)
  await page.click('[data-test=freeform-sketch-preview]')
  await page.waitForSelector('[data-test=freeform-sketch-preview-ready]', { timeout: 120000 })
  await page.$eval('[data-test=freeform-surface-display]', e => Array.from(e.querySelectorAll('button')).find(b => b.textContent === 'Deviation').click())
  await page.waitForSelector('[data-test=freeform-deviation-legend]', { timeout: 120000 })
  assert.ok(await page.evaluate(() => window.__re.reScene().bodyPreview.material.vertexColors))

  assert.equal(await count(), before)
  assert.ok(await page.evaluate(() => window.__re.reScene().bodyPreview?.geometry.attributes.position.count > 0))
  assert.ok(await page.evaluate(() => window.__re.reScene().cagePreview?.geometry.attributes.position.count > 0))
  assert.equal(await page.$eval('[data-test=undo]', e => e.title), undoBefore)
  await page.keyboard.press('Escape')
  await page.waitForSelector(dialog, { hidden: true })
  assert.equal(await page.evaluate(() => window.__re.reScene().bodyPreview), null)
  assert.equal(await page.evaluate(() => window.__re.reScene().cagePreview), null)
  await page.click(button)
  await page.waitForSelector(dialog)
  await page.click('[data-test=freeform-sketch-preview]')
  await page.waitForSelector('[data-test=freeform-sketch-preview-ready]', { timeout: 120000 })
  await setResolution('2')
  await page.waitForSelector('[data-test=freeform-sketch-preview-ready]', { hidden: true })
  assert.equal(await page.evaluate(() => window.__re.reScene().bodyPreview), null)
  assert.equal(await page.evaluate(() => window.__re.reScene().cagePreview), null)
  await page.click('[data-test=freeform-sketch-preview]')
  await page.waitForSelector('[data-test=freeform-sketch-preview-ready]', { timeout: 120000 })
  await page.screenshot({ path: shotPath('freeform-sketch-dialog.png') })
  await page.click('[data-test=freeform-sketch-ok]')
  await page.waitForSelector(dialog, { hidden: true, timeout: 120000 })
  assert.equal(await count(), before + 1)
  const feature = await page.evaluate(() => window.__re.store.getState().features.find(f => f.kind === 'freeform'))
  assert.equal(feature.fromSketch.resolution, 2)
  assert.equal(feature.faces.length, 16)
  assert.equal(await page.evaluate(() => window.__re.reScene().bodyPreview), null)
  assert.equal(await page.evaluate(() => window.__re.reScene().cagePreview), null)
  await page.mouse.move(1200, 700)
  await page.keyboard.down(MOD); await page.keyboard.press('KeyZ'); await page.keyboard.up(MOD)
  await page.waitForFunction(n => document.querySelectorAll('[data-test=feature-row]').length === n, {}, before)
  console.log('After undo, redo enabled:', await page.$eval('[data-test=redo]', e => !e.disabled))
  // The feature list updates before asynchronous history restoration finishes.
  await page.waitForFunction(() => !document.querySelector('[data-test=redo]').disabled)
  await page.keyboard.down(MOD); await page.keyboard.down('Shift'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Shift'); await page.keyboard.up(MOD)
  await page.waitForFunction(n => document.querySelectorAll('[data-test=feature-row]').length === n, {}, before + 1)
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark')
  assert.deepEqual(consoleErrors, [])
  console.log('PASS From 3D Sketch prerequisite, source, default, cancel, resolution validation, 16-quad creation, undo/redo, dark theme')
} finally { await browser.close() }
