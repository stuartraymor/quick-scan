// SPDX-License-Identifier: AGPL-3.0-only
// 1.2.16, two things found with the installed 1.2.15 beside QUICKSURFACE
// 8.0.128, through the real UI on the project used side by side:
// - Zoom to Fit frames every object shown, as QUICKSURFACE's does: a CAD
//   body modelled at the origin, 300 mm from the scan, was left off screen
//   because Zoom to Fit looked at the scan alone;
// - a locked datum plane's row reads "Locked" on screen (the label was in
//   the page but hidden by the compact panels' rule for small tags).
// PROJECT is the saved project (a scan, Plane(1), sketch Profile on world Z
// at the origin, extrude Wall, body Solid 1 hidden).
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { launchApp, check, finish, sleep } from '../../../scripts/e2e-lib.mjs'

const project = resolve(process.env.PROJECT ?? '../../analysis/quick-scan-v1.2.15/native/SIDE-quickscan.scanruler')
const out = resolve(process.env.OUT_DIR ?? '../../analysis/quick-scan-v1.2.16/gui')
mkdirSync(out, { recursive: true })
const { browser, page, consoleErrors } = await launchApp({ protocolTimeout: 240000 })

// How much of a box the camera sees: its eight corners in normalised
// device coordinates, the share inside the frame and its width on screen.
const framed = (what) => page.evaluate((what) => {
  const cam = window.__re.scene().camera
  let box, m
  if (what === 'body') {
    const mesh = [...window.__re.reScene().bodyMeshes.values()][0]
    box = mesh.geometry.boundingBox; m = mesh.matrixWorld
  } else {
    const mesh = window.__re.scene().mesh
    mesh.geometry.computeBoundingBox(); box = mesh.geometry.boundingBox; m = mesh.matrixWorld
  }
  let inside = 0, minX = Infinity, maxX = -Infinity
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const p = box.min.clone().set(x, y, z).applyMatrix4(m).project(cam)
    if (Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && p.z < 1) inside++
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
  }
  return { inside, width: maxX - minX }
}, what)
const onScreen = (sel) => page.evaluate(sel => { const e = document.querySelector(sel); if (!e) return false; const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return Boolean(hit && (hit === e || e.contains(hit) || hit.contains(e))) }, sel)
const zoomFit = async () => {
  await page.click('.navigation-toggle')
  await page.waitForSelector('[data-test=corner-fit]', { visible: true })
  await page.click('[data-test=corner-fit]')
  await sleep(800)
  if (await page.$('[data-test=corner-fit]')) { await page.click('.navigation-toggle'); await sleep(200) }
}

try {
  await page.waitForSelector('[data-test=project-input]')
  await (await page.$('[data-test=project-input]')).uploadFile(project)
  await page.waitForFunction(() => /Project opened/.test(document.querySelector('.strip')?.textContent ?? ''), { timeout: 180000 })
  await page.waitForFunction(() => (window.__re?.store.getState().bodies?.length ?? 0) > 0 && !window.__re.store.getState().building, { timeout: 180000 })
  const body = await page.evaluate(() => window.__re.store.getState().bodies[0])
  check(body && !body.visible, `fixture: ${body?.name} opens hidden, as saved`)

  // 1. Show the body by its eye in Objects, then Zoom to Fit.
  await page.click(`.explorer-objects input[aria-label="${body.name} visibility"], input[aria-label="${body.name} visibility"]`)
  await page.waitForFunction(() => window.__re.store.getState().bodies[0].visible)
  await zoomFit()
  const before = await framed('body')
  check(before.inside === 8, `Zoom to Fit brings the body at the origin on screen (${before.inside}/8 corners in frame)`)
  const scan1 = await framed('scan')
  check(scan1.inside === 8, `and keeps the scan in frame (${scan1.inside}/8)`)
  await page.screenshot({ path: resolve(out, '20-zoom-fit-body.png') })

  // 2. A hidden body is not framed: hide it, fit, the scan fills more.
  await page.click(`input[aria-label="${body.name} visibility"]`)
  await page.waitForFunction(() => !window.__re.store.getState().bodies[0].visible)
  await zoomFit()
  const scan2 = await framed('scan')
  check(scan2.inside === 8 && scan2.width > scan1.width * 1.2, `with the body hidden, Zoom to Fit frames the scan alone (width ${scan1.width.toFixed(2)} → ${scan2.width.toFixed(2)})`)

  // 3. Lock a plane from its menu: "Locked" on its row, on screen.
  const plane = await page.evaluate(() => window.__scanruler.measure.getState().elements.find(e => e.kind === 'plane'))
  const row = `[data-test="explorer-element-${plane.id}"]`
  await page.$eval(row, e => e.scrollIntoView({ block: 'center' }))
  await page.click(row, { button: 'right' })
  await page.waitForSelector('.explorer-core-menu [data-test="explorer-core-lock"]', { visible: true })
  await page.click('.explorer-core-menu [data-test="explorer-core-lock"]')
  await sleep(300)
  const label = `[data-test="explorer-locked-${plane.id}"]`
  check(await onScreen(label), 'a locked plane\'s row reads "Locked", on screen')
  check(await page.$eval(label, e => e.textContent === 'Locked' && getComputedStyle(e).display !== 'none'), 'the label is "Locked" and displayed')
  check(await page.$$eval(`.explorer-history-panel ${label}, .explorer-history ${label}`, es => es.length === 0 || es.every(e => getComputedStyle(e).display !== 'none')), 'History\'s row shows it too, where it has one')
  const nameStill = await page.$eval(row, e => { const s = e.querySelector('span:not(.explorer-color)'); const r = s.getBoundingClientRect(); return r.width > 10 })
  check(nameStill, 'the name stays readable beside it')
  await page.screenshot({ path: resolve(out, '21-locked-label.png'), clip: await page.$eval('.object-explorer', e => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: Math.min(r.height, 500) } }) })
  await page.click(row, { button: 'right' })
  await page.waitForSelector('.explorer-core-menu [data-test="explorer-core-lock"]', { visible: true })
  await page.click('.explorer-core-menu [data-test="explorer-core-lock"]')
  await sleep(300)
  check(!(await page.$(label)), 'Unlock takes the label away')
} catch (e) {
  check(false, String(e))
}
await finish(browser, consoleErrors)
