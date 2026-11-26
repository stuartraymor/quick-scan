// SPDX-License-Identifier: AGPL-3.0-only
// Auto Freeform in the window (1.2.31): the dialog as QUICKSURFACE lays it
// out, a preview made in its own worker with the page left free, Stop,
// Clear Result, guide curves, the result's numbers, OK, undo and redo.
//
// With SCAN=<a real scan> it also runs Medium on it and writes how long the
// preview took and the longest the page went without a frame meanwhile.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SphereGeometry } from 'three'
import { launchApp, loadScan, MOD, OUT_DIR, repoFile, shotPath } from '../../../scripts/e2e-lib.mjs'

const sphere = new SphereGeometry(20, 64, 48), vertices = sphere.getAttribute('position'), indices = sphere.index
let obj = ''
for (let i = 0; i < vertices.count; i++) obj += `v ${vertices.getX(i)} ${vertices.getY(i)} ${vertices.getZ(i)}\n`
for (let i = 0; i < indices.count; i += 3) obj += `f ${indices.getX(i) + 1} ${indices.getX(i + 1) + 1} ${indices.getX(i + 2) + 1}\n`
const file = join(OUT_DIR, 'auto-sphere.obj')
writeFileSync(file, obj)
const { browser, page, consoleErrors } = await launchApp()
const button = '[data-test=ribbon-auto-freeform]', dialog = '[data-test=auto-freeform-dialog]'
const features = () => page.evaluate(() => document.querySelectorAll('[data-test=feature-row]').length)
const type = (sel, text) => page.$eval(sel, (e, text) => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(e, text); e.dispatchEvent(new Event('input', { bubbles: true })) }, text)
const noPreview = async () => {
  assert.equal(await page.evaluate(() => window.__re.reScene().bodyPreview), null)
  assert.equal(await page.evaluate(() => window.__re.reScene().cagePreview), null)
}
const preview = async (timeout = 180000) => {
  await page.click('[data-test=auto-freeform-preview]')
  await page.waitForSelector('[data-test=auto-freeform-quads]', { timeout })
  return Number((await page.$eval('[data-test=auto-freeform-quads]', e => e.textContent)).replace(/[^0-9]/g, ''))
}
const visible = sel => page.$eval(sel, e => getComputedStyle(e.closest('label') ?? e).visibility !== 'hidden')
try {
  await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(e => e.textContent.trim() === 'Freeform').click())
  assert.equal(await page.$eval(button, e => e.disabled), true)
  await loadScan(page, file)
  await page.click(button)
  await page.waitForSelector(dialog, { timeout: 120000 })

  // The dialog as QUICKSURFACE's: the controls, their order and what they start at.
  const labels = await page.$eval(dialog + ' form', f => Array.from(f.querySelectorAll('fieldset:not(.ff-display) > label, .ff-auto-pair button, .ff-preview-actions button')).map(e => e.textContent.replace(/\s+/g, ' ').trim().replace(/ ?(Basic|Low|None).*$/, '')))
  assert.deepEqual(labels.slice(0, 11), ['Algorithm', 'Extract from selected triangles only', 'Target Quads Count', 'Feature Details', 'Symmetry', "Improve holes' boundaries", 'Draw guide curves on the mesh', 'Remove Last Curve', 'Clear all curves', 'Preview', 'Clear Result'])
  assert.equal(await page.$eval('[data-test=auto-freeform-algorithm]', e => e.value), 'feature')
  assert.equal(await page.$eval('[data-test=auto-freeform-algorithm]', e => e.selectedOptions[0].textContent), 'Feature aligned')
  assert.equal(await page.$eval('[aria-label="Target Quads Count"]', e => e.value), 'medium')
  assert.equal(await page.$eval('[aria-label="Quads"]', e => e.value), '2000')
  assert.equal(await page.$eval('[aria-label="Quads"]', e => e.disabled), true)
  assert.equal(await page.$eval('[data-test=auto-freeform-details]', e => e.value), 'balanced')
  assert.equal(await page.$eval('[aria-label="Symmetry"]', e => e.value), 'none')
  assert.equal(await page.$eval('[data-test=auto-freeform-selected]', e => e.disabled), true)
  assert.equal(await page.$eval('[data-test=auto-freeform-holes]', e => e.checked), false)
  assert.equal(await page.$eval('[data-test=auto-freeform-guides]', e => e.checked), false)
  assert.equal(await page.$eval('[data-test=auto-freeform-ok]', e => e.disabled), true)
  assert.equal(await page.$eval('[data-test=auto-freeform-clear]', e => e.disabled), true)
  assert.ok(await page.evaluate(() => document.querySelector('.statusbar, [data-test=status]')?.textContent.includes('Set desired resolution and press Preview.') ?? true))
  // Basic: the feature controls are not shown, and their room is kept.
  const previewTop = () => page.$eval('[data-test=auto-freeform-preview]', e => e.getBoundingClientRect().top)
  const top = await previewTop()
  await page.select('[data-test=auto-freeform-algorithm]', 'basic')
  for (const sel of ['[data-test=auto-freeform-details]', '[aria-label="Symmetry"]', '[data-test=auto-freeform-holes]', '[data-test=auto-freeform-guides]']) assert.equal(await visible(sel), false, sel)
  assert.equal(await previewTop(), top)
  await page.select('[data-test=auto-freeform-algorithm]', 'feature')
  assert.equal(await visible('[data-test=auto-freeform-details]'), true)
  // Help, and More.
  await page.click('[data-test=auto-freeform-help]')
  assert.ok(await page.$('[data-test=auto-freeform-help-text]'))
  await page.click('[data-test=auto-freeform-help]')
  assert.equal(await page.$('[data-test=auto-freeform-help-text]'), null)
  assert.equal(await page.$eval('.ff-auto-more', e => e.open), false)

  const initialViewport = page.viewport()
  await page.setViewport({ width: 1000, height: 480 })
  assert.ok(await page.$eval(dialog + ' form', e => e.getBoundingClientRect().bottom <= innerHeight))
  await page.screenshot({ path: shotPath('auto-freeform-short-window.png') })
  await page.setViewport(initialViewport)
  await page.keyboard.press('Escape')
  await page.waitForSelector(dialog, { hidden: true })
  assert.equal(await features(), 0)

  await page.click(button)
  await page.waitForSelector(dialog)
  await page.select('[aria-label="Target Quads Count"]', 'custom')
  await type('[aria-label="Quads"]', '99')
  await page.waitForFunction(() => document.querySelector('[data-test=auto-freeform-preview]').disabled)
  await type('[aria-label="Quads"]', '200')
  await page.waitForFunction(() => !document.querySelector('[data-test=auto-freeform-preview]').disabled)
  // The view turns and zooms with the dialog open.
  const camera = () => page.evaluate(() => {
    const c = window.__scanruler.scene().viewport.camera
    return { quaternion: c.quaternion.toArray(), zoom: c.zoom }
  })
  const cameraBefore = await camera()
  await page.mouse.move(1000, 500)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(1100, 550, { steps: 12 })
  await page.mouse.up({ button: 'middle' })
  assert.notDeepEqual((await camera()).quaternion, cameraBefore.quaternion)
  await page.mouse.wheel({ deltaY: 200 })
  await page.waitForFunction(z => window.__scanruler.scene().viewport.camera.zoom !== z, {}, cameraBefore.zoom)
  assert.ok(await page.$(dialog))

  // Escape while a preview is being made: the run is stopped, nothing is left.
  await page.click('[data-test=auto-freeform-preview]')
  await page.keyboard.press('Escape')
  await page.waitForSelector(dialog, { hidden: true })
  await new Promise(r => setTimeout(r, 1500))
  assert.equal(await features(), 0)
  await noPreview()

  // Preview: a surface and its cage on the part, numbers in the dialog, no history.
  await page.click(button)
  await page.waitForSelector(dialog)
  await page.select('[aria-label="Target Quads Count"]', 'custom')
  await type('[aria-label="Quads"]', '200')
  await page.select('[aria-label="Symmetry"]', 'oyz')
  const undoBefore = await page.evaluate(() => document.querySelector('[data-test=undo]')?.getAttribute('title'))
  assert.equal(typeof undoBefore, 'string')
  const quads = await preview()
  assert.ok(Math.abs(quads / 200 - 1) < 0.12, `Smooth sphere stays near the custom target of 200 quads: ${quads}`)
  assert.equal(await features(), 0)
  assert.ok(await page.evaluate(() => window.__re.reScene().bodyPreview?.geometry.attributes.position.count > 0))
  assert.ok(await page.evaluate(() => window.__re.reScene().cagePreview?.geometry.attributes.position.count > 0))
  assert.equal(await page.evaluate(() => document.querySelector('[data-test=undo]')?.getAttribute('title')), undoBefore)
  assert.equal(await page.$eval(dialog, e => getComputedStyle(e).backgroundColor), 'rgba(0, 0, 0, 0)')
  assert.ok(await page.$eval(dialog + ' form', e => e.getBoundingClientRect().right < innerWidth / 2))
  const stats = await page.$eval('[data-test=auto-freeform-stats]', e => e.textContent)
  assert.match(stats, /Deviation: RMS .*max/)
  assert.match(stats, /% within/)
  assert.match(stats, /irregular point/)
  assert.match(stats, /closed/)
  assert.equal(await page.$('[data-test=auto-freeform-progress]'), null)
  await page.screenshot({ path: shotPath('auto-freeform-preview.png') })

  const displayClick = text => page.$eval('[data-test=freeform-surface-display]', (e, text) => Array.from(e.querySelectorAll('button')).find(b => b.textContent === text).click(), text)
  const viewportToggle = '[data-test=auto-viewport-deviation]'
  await page.click(viewportToggle)
  await page.waitForSelector('[data-test=freeform-deviation-legend]', { timeout: 120000 })
  const samples = await page.evaluate(() => {
    const preview = window.__re.reScene().bodyPreview
    return { n: preview.geometry.attributes.scanSample.count, vertices: preview.geometry.attributes.position.count,
      id: preview.geometry.uuid, wires: window.__re.reScene().cagePreview.geometry.index.count }
  })
  assert.equal(samples.n, samples.vertices)
  assert.ok(samples.wires > 8 * quads)
  await displayClick('Options')
  await type('[aria-label="Deviation tolerance"]', '0')
  assert.equal(await page.$eval('[data-test=deviation-options-ok]', e => e.disabled), true)
  await type('[aria-label="Deviation tolerance"]', '0.2')
  await page.click('input[name=freeform-colouring][value=pass-fail]')
  await page.click('[data-test=deviation-options-ok]')
  await page.waitForSelector('[data-test=freeform-deviation-options]', { hidden: true })
  assert.ok(await page.$eval('[data-test=freeform-deviation-legend]', e => e.textContent.includes('0.2') && e.textContent.includes('Mean')))
  const display = await page.evaluate(() => {
    const preview = window.__re.reScene().bodyPreview, u = preview.material.userData.freeformAnalysis
    return {id: preview.geometry.uuid, tolerance: u.tolerance.value, passFail: u.passFail.value}
  })
  assert.deepEqual(display, {id: samples.id, tolerance: 0.2, passFail: true})
  await page.click(viewportToggle)
  assert.equal(await page.$('[data-test=freeform-deviation-legend]'), null)
  await page.click(viewportToggle)
  assert.equal(await page.evaluate(() => window.__scanruler.scene().scanShown()), true)
  await displayClick('Surface Only (Space)')
  assert.equal(await page.evaluate(() => window.__scanruler.scene().scanShown()), false)
  await page.$eval('[data-test=auto-freeform-dialog] form', e => e.focus())
  await page.keyboard.press('Space')
  assert.equal(await page.evaluate(() => window.__scanruler.scene().scanShown()), true)
  await page.screenshot({ path: shotPath('auto-freeform-deviation.png') })
  await displayClick('Shaded')
  assert.equal(await page.evaluate(() => window.__re.reScene().bodyPreview.material.color.getHexString()), '56b8a2')
  assert.equal(await page.evaluate(() => window.__scanruler.scene().scanShown()), true)
  assert.equal(await page.evaluate(() => !!window.__re.reScene().bodyPreview.material.userData.freeformAnalysis), false)

  // Clear Result takes the preview away and greys OK again.
  await page.click('[data-test=auto-freeform-clear]')
  await noPreview()
  assert.equal(await page.$eval('[data-test=auto-freeform-ok]', e => e.disabled), true)
  assert.equal(await features(), 0)
  // The algorithm changed: the result stays until the next Preview. Anything else changed: it goes.
  await preview()
  await page.select('[data-test=auto-freeform-algorithm]', 'basic')
  assert.ok(await page.$('[data-test=auto-freeform-quads]'))
  await page.select('[data-test=auto-freeform-algorithm]', 'feature')
  await page.select('[aria-label="Symmetry"]', 'none')
  await page.waitForSelector('[data-test=auto-freeform-quads]', { hidden: true })
  await noPreview()

  // Guide curves: two clicks on the mesh and a double-click make one; the keys take it away.
  await page.click('[data-test=auto-freeform-guides]')
  assert.equal(await page.$eval('[data-test=auto-freeform-remove-curve]', e => e.disabled), true)
  const canvas = await page.$eval('.viewport canvas', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width * 0.42, y: r.top + r.height * 0.45 } })
  await page.mouse.click(canvas.x - 40, canvas.y)
  await page.mouse.click(canvas.x + 40, canvas.y + 20)
  await page.mouse.click(canvas.x + 70, canvas.y - 10, { count: 2 })
  await page.waitForFunction(() => !document.querySelector('[data-test=auto-freeform-remove-curve]').disabled)
  await page.screenshot({ path: shotPath('auto-freeform-guide.png') })
  const withGuide = await preview()
  assert.ok(withGuide > 0)
  await page.click('[data-test=auto-freeform-clear-curves]')
  assert.equal(await page.$eval('[data-test=auto-freeform-remove-curve]', e => e.disabled), true)
  await page.waitForSelector('[data-test=auto-freeform-quads]', { hidden: true })
  await page.click('[data-test=auto-freeform-guides]')

  // More: Refine to tolerance adds quads.
  await page.click('[data-test=auto-freeform-more]')
  await page.select('[data-test=auto-freeform-algorithm]', 'basic')
  const plain = await preview()
  assert.ok(Math.abs(plain - 200) <= 30, `Basic at 200: ${plain}`)
  await page.click('[data-test=auto-freeform-refine]')
  await type('[aria-label="Refine tolerance"]', '0.005')
  const refined = await preview()
  assert.ok(refined > plain, `refined ${refined} against ${plain}`)
  await page.click('[data-test=auto-freeform-refine]')

  // Cancel leaves nothing.
  await page.keyboard.press('Escape')
  await page.waitForSelector(dialog, { hidden: true })
  await noPreview()
  assert.equal(await features(), 0)

  // OK keeps the previewed cage as a freeform: one feature, one body, one undo step.
  await page.click(button)
  await page.waitForSelector(dialog)
  await page.select('[aria-label="Target Quads Count"]', 'custom')
  await type('[aria-label="Quads"]', '100')
  await page.select('[aria-label="Symmetry"]', 'oyz')
  const previewQuads = await preview()
  await page.screenshot({ path: shotPath('auto-freeform-dialog.png') })
  await page.click('[data-test=auto-freeform-ok]')
  await page.waitForSelector(dialog, { hidden: true, timeout: 300000 })
  assert.equal(await features(), 1)
  const committed = await page.evaluate(() => { const f = window.__re.store.getState().features.find(f => f.kind === 'freeform'); return { positions: f.positions, faces: f.faces.length } })
  assert.equal(committed.faces, previewQuads)
  // Symmetric about x = 0: every vertex has its mirror image.
  const pts = []
  for (let i = 0; i < committed.positions.length; i += 3) pts.push(committed.positions.slice(i, i + 3))
  for (const p of pts) assert.ok(pts.some(q => Math.hypot(q[0] + p[0], q[1] - p[1], q[2] - p[2]) < 1e-6), `no mirror image of ${p}`)
  assert.ok(pts.filter(p => p[0] === 0).length > 4)
  await noPreview()
  assert.equal(await page.evaluate(() => document.querySelectorAll('[data-test=body-row]').length), 1)
  await page.mouse.move(1200, 700)
  await page.keyboard.down(MOD); await page.keyboard.press('KeyZ'); await page.keyboard.up(MOD)
  await page.waitForFunction(() => document.querySelectorAll('[data-test=feature-row]').length === 0)
  await page.keyboard.down(MOD); await page.keyboard.down('Shift'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Shift'); await page.keyboard.up(MOD)
  await page.waitForFunction(() => document.querySelectorAll('[data-test=body-row]').length === 1, { timeout: 120000 })
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark')
  await page.screenshot({ path: shotPath('auto-freeform-result.png') })

  // A real scan, when one is given: Medium, with the page's frames watched, and Stop.
  if (process.env.SCAN) {
    await page.keyboard.down(MOD); await page.keyboard.press('KeyZ'); await page.keyboard.up(MOD)
    await page.waitForFunction(() => document.querySelectorAll('[data-test=feature-row]').length === 0)
    await loadScan(page, repoFile(process.env.SCAN))
    await page.click(button)
    await page.waitForSelector(dialog)
    await page.select('[data-test=auto-freeform-algorithm]', 'basic')
    await page.evaluate(() => {
      const w = window
      w.__frames = { longest: 0, last: performance.now(), on: true }
      const tick = () => {
        const now = performance.now()
        w.__frames.longest = Math.max(w.__frames.longest, now - w.__frames.last)
        w.__frames.last = now
        if (w.__frames.on) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    // Stop, mid-run.
    await page.click('[data-test=auto-freeform-preview]')
    await page.waitForSelector('[data-test=auto-freeform-progress]', { timeout: 30000 })
    const stopAt = Date.now()
    await page.click('[data-test=auto-freeform-stop]')
    await page.waitForSelector('[data-test=auto-freeform-progress]', { hidden: true, timeout: 5000 })
    const stopMs = Date.now() - stopAt
    assert.ok(stopMs < 500, `Stop took ${stopMs} ms`)
    assert.equal(await page.$('[data-test=auto-freeform-quads]'), null)
    assert.equal(await page.$eval('[data-test=auto-freeform-preview]', e => e.disabled), false)
    await noPreview()
    await page.evaluate(() => { window.__frames.longest = 0; window.__frames.last = performance.now() })
    const started = Date.now()
    const real = await preview(300000)
    const previewMs = Date.now() - started
    const longestFrame = await page.evaluate(() => { window.__frames.on = false; return window.__frames.longest })
    const text = await page.$eval('[data-test=auto-freeform-stats]', e => e.textContent)
    await page.screenshot({ path: shotPath('auto-freeform-real-scan.png') })
    const record = { scan: process.env.SCAN, algorithm: 'basic', target: 2000, quads: real, previewMs, longestFrameMs: Math.round(longestFrame), stopMs, stats: text }
    writeFileSync(join(OUT_DIR, 'auto-freeform-real-scan.json'), JSON.stringify(record, null, 2))
    console.log('REAL SCAN', JSON.stringify(record))
    assert.ok(Math.abs(real - 2000) / 2000 < 0.08, `Medium on the real scan: ${real}`)
    assert.ok(longestFrame < 250, `the page went ${Math.round(longestFrame)} ms without a frame during the preview`)
    await page.keyboard.press('Escape')
    await page.waitForSelector(dialog, { hidden: true })
  }
  assert.deepEqual(consoleErrors, [])
  console.log('PASS Auto Freeform: dialog layout, worker preview, Stop, guide curves, refine, clear, cancel without mutation, commit with symmetry, undo/redo, dark theme')
} finally { await browser.close() }
