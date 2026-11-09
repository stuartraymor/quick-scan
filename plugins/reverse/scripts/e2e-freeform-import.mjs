// SPDX-License-Identifier: AGPL-3.0-only
// Exercise the real ribbon/file chooser and shared history, without a scan.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, MOD, OUT_DIR, shotPath } from '../../../scripts/e2e-lib.mjs'

let obj = ''
for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) obj += `v ${i * 10} ${j * 10} 0\n`
for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
  const n = j * 3 + i + 1
  obj += `f ${n} ${n + 1} ${n + 4} ${n + 3}\n`
}
const valid = join(OUT_DIR, 'quad-patch.obj'), invalid = join(OUT_DIR, 'invalid-cage.obj')
writeFileSync(valid, obj)
writeFileSync(invalid, 'v 0 0 0\nf 1 2 3 4\n')
const { browser, page, consoleErrors } = await launchApp()
const button = '[data-test=ribbon-from-quad-obj-]'
const documentState = () => page.evaluate(() => ({
  features: Array.from(document.querySelectorAll('[data-test=feature-row]')).map(e => e.textContent),
  bodies: document.querySelectorAll('[data-test=body-row]').length,
}))
async function choose(file) {
  await page.waitForFunction(selector => !document.querySelector(selector)?.disabled, { timeout: 120000 }, button)
  const chooser = page.waitForFileChooser()
  await page.click(button)
  await (await chooser).accept([file])
  // Ribbon hover help otherwise covers the status message.
  await page.mouse.move(1200, 700)
}
async function history(redo) {
  await page.keyboard.down(MOD)
  if (redo) await page.keyboard.down('Shift')
  await page.keyboard.press('KeyZ')
  if (redo) await page.keyboard.up('Shift')
  await page.keyboard.up(MOD)
}
try {
  await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(e => e.textContent.trim() === 'Freeform').click())
  await page.waitForSelector(button)
  await choose(valid)
  await page.waitForFunction(() => /Imported freeform cage/.test(document.querySelector('.strip')?.textContent ?? ''), { timeout: 120000 })
  const imported = await documentState()
  assert.equal(imported.features.length, 1)
  assert.match(imported.features[0], /Freeform/i)
  assert.equal(imported.bodies, 1)
  assert.equal(await page.evaluate(() => document.querySelectorAll('[data-test=freeform-obj-input]').length), 0)
  await history(false)
  await page.waitForFunction(() => document.querySelectorAll('[data-test=feature-row]').length === 0)
  await history(true)
  await page.waitForFunction(() => document.querySelectorAll('[data-test=feature-row]').length === 1)
  await choose(invalid)
  await page.waitForFunction(() => /Could not import freeform cage/.test(document.querySelector('.strip')?.textContent ?? ''))
  assert.deepEqual(await documentState(), imported)
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark')
  assert.deepEqual(consoleErrors, [])
  await page.screenshot({ path: shotPath('freeform-import.png') })
  console.log('PASS freeform OBJ file chooser, no scan, undo/redo, invalid-file preservation, dark theme')
} finally {
  await browser.close()
}
