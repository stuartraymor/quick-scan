// SPDX-License-Identifier: AGPL-3.0-only
// 1.2.15, Objects and History after the side-by-side with QUICKSURFACE
// 8.0.128, through the real UI: the Parent/Child view nested the way
// QUICKSURFACE nests it, a datum plane's 2D Sketch, Flip and Lock/Unlock,
// a sketch's Duplicate, Transparent on one body, a body clicked in the view
// picking its rows, the Elements panel's delete asking with the dependents,
// and the scan's eye — then save, reopen in a fresh page and do it again.
// Fixture objects come from store actions; every action under test is a
// click or a key press. Read app state from the DOM or window hooks only.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { APP_URL, launchApp, loadScan, repoFile, check, finish, sleep } from '../../../scripts/e2e-lib.mjs'
import { openReverse } from './lib.mjs'

const out = resolve(process.env.OUT_DIR ?? '../../analysis/quick-scan-v1.2.15/gui')
mkdirSync(out, { recursive: true })
for (const f of readdirSync(out)) if (f.endsWith('.scanruler')) rmSync(resolve(out, f))
const { browser, page, consoleErrors } = await launchApp({ protocolTimeout: 240000 })
const results = []
const record = (ok, label) => { check(ok, label); results.push({ ok: Boolean(ok), label }) }
// On screen, not just in the DOM: a box, and the point at its centre hits it.
const onScreen = (p, sel) => p.evaluate(sel => { const e = document.querySelector(sel); if (!e) return false; const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return Boolean(hit && (hit === e || e.contains(hit) || hit.contains(e))) }, sel)

function helpers(p) {
  const re = (fn, ...a) => p.evaluate(fn, ...a)
  const labels = () => p.$$eval('.explorer-core-menu button', es => es.map(e => (e.disabled ? '~' : '') + e.querySelector('.explorer-core-menu-label').textContent))
  const menu = async sel => { await p.waitForSelector(sel, { visible: true }); await p.$eval(sel, e => e.scrollIntoView({ block: 'center' })); await p.click(sel, { button: 'right' }); await p.waitForSelector('.explorer-core-menu', { visible: true }); return labels() }
  const choose = async id => { await p.click(`.explorer-core-menu [data-test="${id}"]`); await sleep(300) }
  const closeMenu = async () => { if (await p.$('.explorer-core-menu')) { await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.explorer-core-menu')) } }
  const undo = async () => { await p.click('[data-test="undo"], [data-test="ribbon-undo"]'); await sleep(400) }
  const plane = id => re(id => { const e = window.__scanruler.measure.getState().elements.find(e => e.id === id); return e && { name: e.name, locked: Boolean(e.locked), flipped: Boolean(e.flipped), nz: e.fit?.normal?.[2] } }, id)
  const built = () => p.waitForFunction(() => !window.__re.store.getState().building && window.__re.store.getState().bodies.length > 0, { timeout: 180000 })
  const sketches = () => re(() => window.__re.store.getState().features.filter(f => f.kind === 'sketch').map(f => ({ id: f.id, name: f.name, plane: f.plane })))
  const historyKeys = () => p.$$eval('#explorer-history [data-order-key]', rows => rows.map(r => r.dataset.orderKey))
  return { re, labels, menu, choose, closeMenu, undo, plane, built, sketches, historyKeys }
}

/** Sweep the view by hover until the canvas offers a face of a body. */
async function bodyHit(p) {
  const view = await p.evaluate(() => { const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0]; const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })
  const frames = () => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
  const cx = view.x + view.w / 2, cy = view.y + view.h / 2
  for (let ring = 0; ring < 14; ring++) {
    for (let a = 0; a < (ring === 0 ? 1 : 8 * ring); a++) {
      const t = ring === 0 ? 0 : (a / (8 * ring)) * Math.PI * 2
      const x = cx + Math.cos(t) * ring * 22, y = cy + Math.sin(t) * ring * 22
      if (x > view.x + view.w - 220 && y < view.y + 160) continue
      await p.mouse.move(x, y); await frames()
      if (await p.evaluate(() => [...document.querySelectorAll('canvas')].some(c => c.style.cursor === 'pointer'))) return { x, y }
    }
  }
  return null
}

const H = helpers(page)
let savedFile = null
let ids = null
try {
  await loadScan(page, process.env.SCAN ?? repoFile('public/reference-examples/basic_part.stl'))
  await openReverse(page)
  ids = await H.re(() => {
    const m = () => window.__scanruler.measure.getState()
    const c = m().modelCenter
    m().startDraft('plane'); m().setDraftMethod('plane-coords'); m().setDraftParams([0, 0, 1, c[0], c[1], c[2]]); m().setDraftName('Datum A')
    const plane = m().commitDraft(); m().cancelDraft?.()
    // At the scan's middle, where the view already looks.
    const XY = { origin: [0, 0, c[2]], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }
    const r = () => window.__re.store.getState()
    r().startSketch({ kind: 'world', axis: 'z', offset: c[2] }, XY); r().setSketchTool('rectangle')
    r().sketchClick([c[0] - 15, c[1] - 15], 0.5, false, { off: true }); r().sketchClick([c[0] + 15, c[1] + 15], 0.5, false, { off: true })
    const sketch = r().commitSketch(); r().startExtrude(sketch); r().setExtrude({ op: 'new', extent: { kind: 'distance', from: 0, to: 10 } }); const extrude = r().commitExtrude()
    return { plane, sketch, extrude }
  })
  await H.built()
  const body = await H.re(() => window.__re.store.getState().bodies[0].id)
  ids.body = body
  record(ids.plane && ids.sketch && ids.extrude && body, `fixture ${JSON.stringify(ids)}`)
  const planeRow = `[data-test="explorer-element-${ids.plane}"]`

  // 1. Parent/Child view: Extrude ▸ Sketch, closed until opened.
  await page.click('[aria-label="Parent/Child View"]'); await sleep(200)
  record(await page.$(`[data-test="explorer-history-feature-${ids.extrude}"]`) && !(await page.$(`[data-test="explorer-history-feature-${ids.sketch}"]`)), 'Parent/Child: the extrude shows, its sketch is inside it (closed)')
  await page.click(`[data-test="explorer-tree-toggle-reverse:feature:${ids.extrude}"]`); await sleep(200)
  record(await page.$eval(`[data-test="explorer-history-feature-${ids.sketch}"]`, (e, x) => e.closest('.explorer-dependency-children')?.parentElement?.dataset.orderKey === `reverse:feature:${x}`, ids.extrude), 'Parent/Child: the arrow opens the extrude onto its sketch')
  await page.click('[aria-label="Collapse History"]'); await sleep(150)
  record(!(await page.$(`[data-test="explorer-history-feature-${ids.sketch}"]`)), 'Collapse all closes it again')
  await page.click('[aria-label="Expand History"]'); await sleep(150)
  record(await page.$(`[data-test="explorer-history-feature-${ids.sketch}"]`), 'Expand all opens it')
  await page.screenshot({ path: resolve(out, '10-parent-child.png') })
  await page.click('[aria-label="History View"]'); await sleep(150)

  // 2. The datum plane's menu: QUICKSURFACE's 2D Sketch, Flip, Lock.
  let l = await H.menu(planeRow)
  record(['2D Sketch', 'Flip', 'Lock', 'Duplicate', 'Rename ...'].every(x => l.includes(x)), `plane menu: ${l.join(' | ')}`)
  await H.choose('explorer-core-flip')
  record((await H.plane(ids.plane)).nz < -0.99, 'Flip turns the plane over (normal z −1)')
  await H.undo()
  record((await H.plane(ids.plane)).nz > 0.99, 'one Undo turns it back')
  await H.menu(planeRow); await H.choose('explorer-core-lock')
  record((await H.plane(ids.plane)).locked && await onScreen(page, `[data-test="explorer-locked-${ids.plane}"]`), 'Lock marks the plane and its row reads Locked, on screen')
  l = await H.menu(planeRow)
  record(l.includes('~Edit ...') && l.includes('Unlock') && l.includes('Flip') && l.includes('Rename ...'), `locked: Edit greyed, Unlock offered, Flip and Rename kept (${l.join(' | ')})`)
  await H.closeMenu()
  await page.click(planeRow, { count: 2 }); await sleep(400)
  record(await H.re(() => window.__scanruler.measure.getState().draft === null) && await page.evaluate(() => document.body.textContent.includes('is locked')), 'double-click on a locked plane is refused with a message')
  await H.menu(planeRow); await H.choose('explorer-core-flip')
  record((await H.plane(ids.plane)).nz < -0.99, 'Flip works on a locked plane, as in QUICKSURFACE')

  // 3. 2D Sketch on the plane, then Duplicate that sketch.
  await H.menu(planeRow); await H.choose('explorer-core-sketch')
  await page.waitForFunction(() => window.__re.store.getState().sketchDraft !== null, { timeout: 30000 })
  const onPlane = await H.re(id => { const d = window.__re.store.getState().sketchDraft; return d?.plane?.kind === 'plane' && d.plane.id === id }, ids.plane)
  record(onPlane, '2D Sketch opens a CAD sketch on the plane')
  const planeSketch = await H.re(() => { const r = () => window.__re.store.getState(); r().setSketchTool('rectangle'); r().sketchClick([-4, -4], 0.5, false, { off: true }); r().sketchClick([4, 4], 0.5, false, { off: true }); return r().commitSketch() })
  await sleep(300)
  const before = (await H.sketches()).length
  l = await H.menu(`[data-test="explorer-object-feature-${planeSketch}"]`)
  record(l.includes('Duplicate'), `sketch menu has Duplicate (${l.join(' | ')})`)
  await H.choose('explorer-sketch-duplicate')
  const sks = await H.sketches()
  const copy = sks.at(-1)
  record(sks.length === before + 1 && / - Copy$/.test(copy.name) && copy.plane?.id === ids.plane, `Duplicate adds "${copy?.name}" on the same plane`)
  record((await H.historyKeys()).at(-1) === `reverse:feature:${copy.id}`, 'the copy is last in History')
  await H.undo()
  record((await H.sketches()).length === before, 'one Undo takes the copy away')

  // 4. The Elements panel's delete asks with the dependents, as the Objects panel does.
  await page.click('[data-test=workspace-elements]'); await sleep(500)
  const planeName = (await H.plane(ids.plane)).name
  const x = await page.$(`button.x[title="Delete ${planeName}"]`)
  record(Boolean(x), `the Elements panel lists ${planeName} with its delete key`)
  if (x) {
    await x.click()
    await page.waitForSelector('[data-test="explorer-delete-confirm"]', { timeout: 5000 })
    const also = await page.$eval('[data-test="explorer-delete-also"]', e => e.textContent).catch(() => '')
    record(also.includes((await H.sketches()).find(s => s.id === planeSketch).name), `Elements panel delete lists the sketch on the plane: "${also}"`)
    await page.click('[data-test="explorer-delete-no"]'); await sleep(200)
    record(await H.plane(ids.plane), 'No keeps the plane')
  }
  await openReverse(page)

  // 5. Transparent on one body.
  await page.click(`[data-test="explorer-body-${body}"]`)
  l = await H.menu(`[data-test="explorer-body-${body}"]`)
  const seeAll = await H.re(() => window.__re.store.getState().bodiesSeeThrough)
  await H.choose('explorer-body-transparent')
  record(await H.re(id => window.__re.store.getState().bodyStyles[id]?.transparent === true, body) && await H.re(() => window.__re.store.getState().bodiesSeeThrough) === seeAll, 'body Transparent applies to that body alone')
  await H.menu(`[data-test="explorer-body-${body}"]`)
  record(await page.$eval('[data-test="explorer-body-transparent"]', e => e.getAttribute('aria-checked')) === 'true', 'its menu shows Transparent ticked')
  await H.closeMenu()

  // 6. A body clicked in the view picks its rows and the card.
  await page.click('[data-test="explorer-object-scan-row"] .explorer-checkbox'); await sleep(300)
  record(await H.re(() => window.__re.store.getState().scanHidden), 'the scan eye hides the scan')
  await page.click(`[data-test="explorer-element-row-${ids.plane}"] .explorer-checkbox`); await sleep(200)
  await page.keyboard.press('Escape'); await sleep(200)
  if (await page.$('[data-test=fit-view]')) { await page.click('[data-test=fit-view]'); await sleep(800) }
  await page.screenshot({ path: resolve(out, '11a-before-view-click.png') })
  const hit = await bodyHit(page)
  record(hit, `a face of the body found under the cursor (${JSON.stringify(hit)})`)
  if (hit) {
    await page.mouse.click(hit.x, hit.y); await sleep(500)
    record(await page.$eval(`[data-test="explorer-body-row-${body}"]`, e => e.classList.contains('selected')), 'the click picks the body row in Objects')
    record(await page.$eval(`[data-test="explorer-history-row-${ids.extrude}"]`, e => e.classList.contains('selected')), 'and the extrude row in History')
    const card = await page.$eval('[data-test="explorer-dependency-card"]', e => e.textContent).catch(() => '')
    record(card.includes(await H.re(id => window.__re.store.getState().features.find(f => f.id === id).name, ids.extrude)), `and the dependency card (${card})`)
    await page.screenshot({ path: resolve(out, '11-view-click.png') })
  }

  // 7. Save with the plane flipped and locked, the body see-through, the scan hidden.
  const cdp = await page.createCDPSession()
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: out })
  await page.click('[data-test="save-project"]')
  for (let n = 0; n < 160 && !readdirSync(out).some(x => x.endsWith('.scanruler')); n++) await sleep(250)
  savedFile = readdirSync(out).find(x => x.endsWith('.scanruler'))
  record(Boolean(savedFile), `project saved (${savedFile})`)
} catch (error) { record(false, error.stack) }

if (savedFile && ids) {
  const p2 = await browser.newPage()
  p2.on('pageerror', e => consoleErrors.push(e.message))
  await p2.setViewport({ width: 1500, height: 950 })
  const H2 = helpers(p2)
  try {
    await p2.goto(APP_URL, { waitUntil: 'networkidle0' })
    const bytes = [...readFileSync(resolve(out, savedFile))]
    await p2.evaluate(data => { const t = new DataTransfer(); t.items.add(new File([new Uint8Array(data)], 'explorer-parity-3.scanruler')); window.dispatchEvent(new DragEvent('drop', { dataTransfer: t, bubbles: true, cancelable: true })) }, bytes)
    await p2.waitForFunction(() => document.body.textContent.includes('Project opened'), { timeout: 120000 })
    await openReverse(p2)
    await H2.built()
    const pl = await H2.plane(ids.plane)
    record(pl?.flipped && pl.nz < -0.99, `reopen keeps the plane flipped (${JSON.stringify(pl)})`)
    record(pl?.locked && await onScreen(p2, `[data-test="explorer-locked-${ids.plane}"]`), 'reopen keeps it locked, row reads Locked, on screen')
    record(await H2.re(id => window.__re.store.getState().bodyStyles[id]?.transparent === true, ids.body), 'reopen keeps the body see-through')
    record(await H2.re(() => window.__re.store.getState().scanHidden) && await p2.$eval('[data-test="explorer-object-scan-row"] input', e => !e.checked), 'reopen keeps the scan hidden, eye shut')
    // The same workflows again.
    const row = `[data-test="explorer-element-${ids.plane}"]`
    await H2.menu(row); await H2.choose('explorer-core-lock')
    record(!(await H2.plane(ids.plane)).locked && !(await p2.$(`[data-test="explorer-locked-${ids.plane}"]`)), 'after reopen: Unlock works')
    await H2.menu(row); await H2.choose('explorer-core-flip')
    record((await H2.plane(ids.plane)).nz > 0.99, 'after reopen: Flip turns it back')
    const sk = (await H2.sketches()).find(s => s.plane?.kind === 'plane')
    await H2.menu(`[data-test="explorer-object-feature-${sk.id}"]`); await H2.choose('explorer-sketch-duplicate')
    record(/ - Copy$/.test((await H2.sketches()).at(-1).name), 'after reopen: Duplicate works')
    await p2.click('[aria-label="Parent/Child View"]'); await sleep(200)
    await p2.click('[aria-label="Expand History"]'); await sleep(200)
    record(await p2.$eval(`[data-test="explorer-history-feature-${ids.sketch}"]`, (e, x) => e.closest('.explorer-dependency-children')?.parentElement?.dataset.orderKey === `reverse:feature:${x}`, ids.extrude), 'after reopen: Parent/Child nests the sketch under the extrude')
    await p2.screenshot({ path: resolve(out, '12-after-reopen.png') })
  } catch (error) { record(false, `reopen: ${error.stack}`) }
}

writeFileSync(resolve(out, 'results-3.json'), JSON.stringify(results, null, 2))
await finish(browser, consoleErrors)
