// SPDX-License-Identifier: AGPL-3.0-only
// Verify actual camera directions, framing and ribbon history dispatch.
import { writeFileSync } from 'node:fs'
import { launchApp, loadScan, check, fail, finish, shotPath } from './e2e-lib.mjs'

const vertices = [[100,200,300],[120,200,300],[120,210,300],[100,210,300],[100,200,330],[120,200,330],[120,210,330],[100,210,330]]
const faces = [[1,3,2],[1,4,3],[5,6,7],[5,7,8],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,4,8],[3,8,7],[4,1,5],[4,5,8]]
const fixture = shotPath('view-box.obj')
writeFileSync(fixture, vertices.map(v => `v ${v.join(' ')}`).concat(faces.map(f => `f ${f.join(' ')}`)).join('\n'))
const { browser, page, consoleErrors } = await launchApp({ agentDataOk: false })
try {
  await loadScan(page, fixture)
  const mainHeight = await page.$eval('.desktop-ribbon', el => el.getBoundingClientRect().height)
  await page.click('[data-test=ribbon-tab-view]')
  check(await page.$eval('.desktop-ribbon', (el, h) => Math.abs(el.getBoundingClientRect().height - h) < 2, mainHeight), 'Edit / View keeps the same ribbon height as Main')
  const directions = { top: [0,0,-1], left: [1,0,0], front: [0,1,0], bottom: [0,0,1], right: [-1,0,0], back: [0,-1,0] }
  const direction = () => page.evaluate(() => window.__scanruler.scene().viewDirection())
  for (const [name, expected] of Object.entries(directions)) {
    const zoom = await page.evaluate(() => window.__scanruler.scene().viewLink().camera.zoom)
    await page.click(`[data-test=ribbon-${name}]`)
    const actual = await direction()
    // OrbitControls nudges a polar direction about 1e-6 radians off its pole.
    check(actual.every((v, i) => Math.abs(v - expected[i]) < 1e-5), `${name} sets the correct camera axis (${actual.join(', ')})`)
    check(await page.evaluate(() => window.__scanruler.scene().viewLink().camera.zoom) === zoom, `${name} preserves zoom`)
  }
  await page.click('[data-test=ribbon-isometric]')
  const iso = await direction()
  check(iso[0] < 0 && iso[1] > 0 && iso[2] < 0, 'Isometric views the part from front/top/right')
  await page.evaluate(() => window.__scanruler.scene().fitBox([500,500,500],[505,505,505]))
  const beforeFit = await direction()
  await page.click('[data-test=ribbon-zoom-to-fit]')
  check(await page.evaluate(() => window.__scanruler.scene().viewLink().target.distanceTo({ x:110, y:205, z:315 }) < 1e-6), 'Zoom To Fit returns to the displaced model centre')
  check((await direction()).every((v,i) => Math.abs(v - beforeFit[i]) < 1e-6), 'Zoom To Fit preserves orientation')
  check(await page.evaluate(() => window.__scanruler.measure.getState().elements.length === 0), 'view actions add no model features')
  await page.evaluate(() => {
    const s = window.__scanruler.measure.getState()
    s.startDraft('point')
    s.setDraftMethod('point-coords')
    s.setDraftParams([110,205,315])
    s.commitDraft()
    s.cancelDraft()
  })
  await page.waitForFunction(() => !document.querySelector('[data-test=ribbon-undo]')?.disabled)
  await page.click('[data-test=ribbon-undo]')
  await page.waitForFunction(() => window.__scanruler.measure.getState().elements.length === 0)
  check(true, 'ribbon Undo applies the shared history')
  await page.click('[data-test=ribbon-redo]')
  await page.waitForFunction(() => window.__scanruler.measure.getState().elements.length === 1)
  check(true, 'ribbon Redo restores the feature')
  await page.screenshot({ path: shotPath('edit-view-ribbon.png') })
} catch (error) { fail(error.stack ?? String(error)) }
finally { await finish(browser, consoleErrors) }
