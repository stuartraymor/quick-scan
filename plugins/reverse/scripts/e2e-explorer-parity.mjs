// SPDX-License-Identifier: AGPL-3.0-only
// Objects and History panels as QUICKSURFACE 8 has them, driven through the
// real UI: object-aware menus, F2 rename, colour, Properties, Hide All But
// This, Disable All Next / Enable To Here, the dependency card, Delete with
// its dependents, Undo, and the same again after save and reopen. Fixture
// objects are made with store actions; every action under test is a click
// or a key press on the panels.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { launchApp, loadScan, repoFile, check, finish, sleep, APP_URL } from '../../../scripts/e2e-lib.mjs'
import { openReverse } from './lib.mjs'

const out = process.env.OUT_DIR ?? resolve('../../analysis/quick-scan-v1.2.14/gui')
mkdirSync(out, { recursive: true })
for (const f of readdirSync(out)) if (f.endsWith('.scanruler')) rmSync(resolve(out, f))
const { browser, page, consoleErrors } = await launchApp({ protocolTimeout: 240000 })
const results = []
const record = (ok, label) => { check(ok, label); results.push({ ok: Boolean(ok), label }) }

function helpers(page) {
  const re = (fn, ...a) => page.evaluate(fn, ...a)
  const labels = () => page.$$eval('.explorer-core-menu .explorer-core-menu-label', es => es.map(e => e.textContent))
  const menu = async sel => {
    await page.waitForSelector(sel, { visible: true })
    await page.click(sel, { button: 'right' })
    await page.waitForSelector('.explorer-core-menu', { visible: true })
    return labels()
  }
  const closeMenu = async () => { if (await page.$('.explorer-core-menu')) { await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.explorer-core-menu')) } }
  const choose = async testId => { await page.click(`.explorer-core-menu [data-test="${testId}"]`); await sleep(150) }
  const undo = async () => { await page.click('[data-test="undo"], [data-test="ribbon-undo"]'); await sleep(250) }
  const feats = () => re(() => { const s = window.__re.store.getState(); return { on: s.features.map(f => [f.id, f.name, f.visible]), back: s.rolledBack.map(f => f.id) } })
  const bodies = () => re(() => window.__re.store.getState().bodies.map(b => ({ id: b.id, name: b.name, color: b.color, visible: b.visible })))
  const built = () => page.waitForFunction(() => !window.__re.store.getState().building && window.__re.store.getState().bodies.length > 0, { timeout: 180000 })
  // Read from the panel: after a hot reload a dynamic import can reach a second copy of the module.
  const order = async () => ({ rollbackAt: (await page.$$eval('.explorer-history-panel .explorer-row.is-rolled', rows => rows.length)) === 0 ? null : 'rolled' })
  return { re, labels, menu, closeMenu, choose, undo, feats, bodies, built, order }
}

const H = helpers(page)
let savedFile = null
let ids = {}
try {
  await loadScan(page, process.env.SCAN ?? repoFile('public/reference-examples/basic_part.stl'))
  await openReverse(page)
  // Fixture: a datum plane, a rectangle sketch on Z and its extrusion.
  ids = await H.re(async () => {
    const m = window.__scanruler.measure.getState()
    m.startDraft('plane'); m.setDraftMethod('plane-coords'); m.setDraftParams([0, 0, 1, ...m.modelCenter]); m.setDraftName('Datum A')
    const plane = m.commitDraft(); window.__scanruler.measure.getState().cancelDraft?.()
    const XY = { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }
    const r = () => window.__re.store.getState()
    r().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY)
    r().setSketchTool('rectangle')
    r().sketchClick([-10, -10], 0.5, false, { off: true })
    r().sketchClick([10, 10], 0.5, false, { off: true })
    const sketch = r().commitSketch()
    r().startExtrude(sketch)
    const extrude = r().commitExtrude()
    return { plane, sketch, extrude }
  })
  await H.built()
  const { plane, sketch, extrude } = ids
  const body = (await H.bodies())[0].id
  const objSketch = `[data-test="explorer-object-feature-${sketch}"]`
  const histSketch = `[data-test="explorer-history-feature-${sketch}"]`
  const histExtrude = `[data-test="explorer-history-feature-${extrude}"]`
  const bodyRow = `[data-test="explorer-body-${body}"]`
  const planeRow = `[data-test="explorer-element-${plane}"]`
  record(plane !== null && sketch !== null && extrude !== null, `fixture: plane ${plane}, sketch ${sketch}, extrude ${extrude}, body ${body}`)

  // 1. Object-aware menus.
  let l = await H.menu(objSketch)
  record(JSON.stringify(l.map(x => x === 'Show' ? 'Hide' : x)) === JSON.stringify(['Edit ...', 'Hide All But This', 'Hide', 'Extrude ...', 'Revolve ...', 'Rename ...', 'Duplicate', 'Delete ...', 'Properties ...']), `Objects sketch menu: ${l.join(' | ')}`)
  await H.closeMenu()
  l = await H.menu(histSketch)
  record(l.includes('-> Disable All Next') && l.includes('Extrude ...'), `History sketch menu adds Disable All Next: ${l.join(' | ')}`)
  await H.closeMenu()
  l = await H.menu(histExtrude)
  record(l.includes('Edit ...') && l.includes('Edit Sketch ...') && l.includes('Hide All But This') && !l.includes('-> Disable All Next') && !l.includes('Extrude ...'), `History extrude menu (last row: no Disable All Next): ${l.join(' | ')}`)
  await H.closeMenu()
  l = await H.menu(bodyRow)
  record(['Edit ...', 'Edit Sketch ...', 'Hide All But This', 'Hide', 'Color ...', 'Set Default Color', 'Transparent', 'Rename ...', 'Delete ...', 'Properties ...'].every(x => l.includes(x)) && !l.includes('Merge'), `body menu: ${l.join(' | ')}`)
  await H.closeMenu()
  l = await H.menu(planeRow)
  record(['Edit ...', 'Hide All But This', 'Hide', 'Color ...', 'Rename ...', 'Duplicate', 'Delete ...', 'Properties ...'].every(x => l.includes(x)), `datum plane menu: ${l.join(' | ')}`)
  await H.closeMenu()
  l = await H.menu('[data-test="explorer-object-scan-row"]')
  record(['Hide All But This', 'Color ...', 'Set Default Color', 'Transparent', 'Wireframe', 'Export ...', 'Properties ...'].every(x => l.includes(x)), `scan menu: ${l.join(' | ')}`)
  await H.closeMenu()

  // 2. F2 rename in History, reflected in Objects; a taken name is refused.
  await page.click(histExtrude)
  await page.keyboard.press('F2')
  await page.waitForSelector('[data-test="explorer-rename-input"]')
  await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control')
  await page.keyboard.type('Wall')
  await page.keyboard.press('Enter')
  await sleep(300)
  record((await H.feats()).on.some(([id, name]) => id === extrude && name === 'Wall'), 'F2 on a History row renames the feature in place')
  await page.click(objSketch)
  await page.keyboard.press('F2')
  await page.waitForSelector('[data-test="explorer-rename-input"]')
  await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control')
  await page.keyboard.type('Wall')
  await page.keyboard.press('Enter')
  await sleep(300)
  record((await H.feats()).on.some(([id, name]) => id === sketch && name !== 'Wall') && await page.evaluate(() => document.body.textContent.includes('already called Wall')), 'a duplicate name is refused with a message')
  await H.menu(objSketch); await H.choose('explorer-feature-rename')
  await page.waitForSelector('[data-test="explorer-rename-input"]')
  await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control')
  await page.keyboard.type('Profile'); await page.keyboard.press('Enter'); await sleep(300)
  record(await page.$eval(histSketch, e => e.textContent.includes('Profile')), 'menu Rename ... renames, and History shows the new name')
  await H.undo()
  record((await H.feats()).on.some(([id, name]) => id === sketch && name !== 'Profile'), 'Undo reverts a rename')
  await page.click('[data-test="redo"], [data-test="ribbon-redo"]'); await sleep(250)
  record((await H.feats()).on.some(([id, name]) => id === sketch && name === 'Profile'), 'Redo repeats the rename')

  // 3. Dependency card on selection.
  await page.click(histSketch)
  await page.waitForSelector('[data-test="explorer-dependency-card"]')
  let card = await page.$eval('[data-test="explorer-dependency-card"]', e => e.textContent)
  record(card.includes('Profile') && card.includes('Wall'), `dependency card for the sketch: "${card}"`)
  await page.click(histExtrude)
  await sleep(150)
  card = await page.$eval('[data-test="explorer-dependency-card"]', e => e.textContent)
  record(card.includes('Wall') && card.includes('Profile'), `dependency card for the extrude: "${card}"`)

  // 4. Properties.
  await H.menu(bodyRow); await H.choose('explorer-body-properties')
  await page.waitForSelector('[data-test="explorer-properties"]')
  const props = await page.$eval('[data-test="explorer-properties"]', e => e.textContent)
  record(props.includes('Volume') && props.includes('Made by') && props.includes('Wall') && props.includes('Solid body'), 'body Properties shows type, maker and volume')
  await page.screenshot({ path: resolve(out, '01-body-properties.png') })
  await page.click('[data-test="explorer-properties-ok"]')
  await H.menu(histExtrude); await H.choose('explorer-feature-properties')
  await page.waitForSelector('[data-test="explorer-properties"]')
  const fprops = await page.$eval('[data-test="explorer-properties"]', e => e.textContent)
  record(fprops.includes('Built on') && fprops.includes('Profile') && fprops.includes('Built'), 'feature Properties shows parent and build status')
  await page.click('[data-test="explorer-properties-ok"]')
  await H.menu(planeRow); await H.choose('explorer-core-properties')
  await page.waitForSelector('[data-test="explorer-properties"]')
  const pprops = await page.$eval('[data-test="explorer-properties"]', e => e.textContent)
  record(pprops.includes('Type') && pprops.includes('Plane'), `datum plane Properties opens: ${pprops}`)
  await page.click('[data-test="explorer-properties-ok"]')

  // 5. Colour through the menu, one undo step.
  await H.menu(bodyRow); await H.choose('explorer-body-color')
  await page.waitForSelector('[data-test="explorer-color-input"]')
  await page.$eval('[data-test="explorer-color-input"]', e => { e.value = '#ff2200'; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })) })
  await sleep(300)
  record((await H.bodies())[0].color === '#ff2200', 'Color ... recolours the body')
  await H.undo()
  record((await H.bodies())[0].color !== '#ff2200', 'Undo reverts the colour')
  await H.menu(bodyRow); await H.choose('explorer-body-color')
  await page.waitForSelector('[data-test="explorer-color-input"]')
  await page.$eval('[data-test="explorer-color-input"]', e => { e.value = '#2299ff'; e.dispatchEvent(new Event('change', { bubbles: true })) })
  await sleep(300)
  await H.menu(planeRow); await H.choose('explorer-core-color')
  await page.waitForSelector('[data-test="explorer-color-input"]')
  await page.$eval('[data-test="explorer-color-input"]', e => { e.value = '#33cc66'; e.dispatchEvent(new Event('change', { bubbles: true })) })
  await sleep(300)
  record(await H.re(id => window.__scanruler.measure.getState().elements.find(e => e.id === id)?.color === '#33cc66', plane), 'Color ... recolours the datum plane')

  // 6. Hide All But This, then Undo.
  const pre = await H.re(id => ({ plane: window.__scanruler.measure.getState().elements.find(e => e.id === id)?.visible, sketch: window.__re.store.getState().features.find(f => f.kind === 'sketch')?.visible }), plane)
  await H.menu(bodyRow); await H.choose('explorer-hide-all-but')
  await sleep(300)
  const iso = await H.re(id => ({
    scan: window.__scanruler.measure.getState().scanVisible ?? null,
    plane: window.__scanruler.measure.getState().elements.find(e => e.id === id)?.visible,
    sketch: window.__re.store.getState().features.find(f => f.kind === 'sketch')?.visible,
    body: window.__re.store.getState().bodies[0].visible && !window.__re.store.getState().bodiesHidden,
  }), plane)
  const scanEye = await page.$eval('[data-test="explorer-object-scan-row"] .explorer-checkbox', e => e.checked)
  record(iso.body && !iso.plane && !iso.sketch && !scanEye, `Hide All But This keeps only the body ${JSON.stringify({ ...iso, scanEye })}`)
  await page.screenshot({ path: resolve(out, '02-hide-all-but-body.png') })
  await H.undo()
  const back = await H.re(id => ({ plane: window.__scanruler.measure.getState().elements.find(e => e.id === id)?.visible, sketch: window.__re.store.getState().features.find(f => f.kind === 'sketch')?.visible }), plane)
  record(back.plane === pre.plane && back.sketch === pre.sketch && await page.$eval('[data-test="explorer-object-scan-row"] .explorer-checkbox', e => e.checked), `one Undo restores every eye as it was ${JSON.stringify({ pre, back })}`)

  // 7. Disable All Next / Enable To Here from History.
  await H.menu(histSketch); await H.choose('explorer-disable-all-next')
  await sleep(500)
  let f = await H.feats()
  record(f.back.includes(extrude) && !f.back.includes(sketch) && await page.$eval(`[data-test="explorer-history-row-${extrude}"]`, e => e.classList.contains('is-rolled')), 'Disable All Next rolls the extrusion back')
  l = await H.menu(histExtrude)
  record(l.includes('<- Enable To Here') && !l.includes('-> Disable All Next'), `rolled-back row offers Enable To Here: ${l.join(' | ')}`)
  await page.screenshot({ path: resolve(out, '03-rolled-back-menu.png') })
  await H.choose('explorer-enable-to-here')
  await H.built()
  f = await H.feats()
  record(f.back.length === 0 && (await H.order()).rollbackAt === null, 'Enable To Here on the last row brings the model to the end')

  // 8. Delete with dependents, from Objects; one Undo restores both.
  await H.menu(objSketch); await H.choose('explorer-delete')
  await page.waitForSelector('[data-test="explorer-delete-confirm"]')
  const also = await page.$eval('[data-test="explorer-delete-also"]', e => e.textContent).catch(() => '')
  record(also.includes('Wall'), `confirmation lists the dependent extrusion: "${also}"`)
  await page.screenshot({ path: resolve(out, '04-delete-with-dependents.png') })
  await page.click('[data-test="explorer-delete-no"]')
  record((await H.feats()).on.length === 2, 'No keeps both')
  await page.click(histSketch)
  await page.keyboard.press('Delete')
  await page.waitForSelector('[data-test="explorer-delete-confirm"]')
  await page.click('[data-test="explorer-delete-yes"]')
  await sleep(500)
  f = await H.feats()
  record(f.on.length === 0 && f.back.length === 0, 'Delete key + Yes removes the sketch and its extrusion')
  await H.undo()
  await H.built()
  f = await H.feats()
  record(f.on.length === 2 && f.on.some(([, n]) => n === 'Wall') && f.on.some(([, n]) => n === 'Profile'), 'one Undo restores both, names kept')

  // 9. Core: Duplicate, Delete key on a selected plane.
  await H.menu(planeRow); await H.choose('explorer-core-duplicate')
  await sleep(300)
  const els = await H.re(() => window.__scanruler.measure.getState().elements.map(e => e.id))
  record(els.length === 2, 'Duplicate copies the datum plane')
  const copy = els.find(id => id !== plane)
  await page.click(`[data-test="explorer-element-${copy}"]`)
  await page.keyboard.press('Delete')
  await page.waitForSelector('[data-test="explorer-delete-confirm"]')
  await page.click('[data-test="explorer-delete-yes"]')
  await sleep(300)
  record((await H.re(() => window.__scanruler.measure.getState().elements.length)) === 1, 'Delete key on a selected plane deletes it after Yes')

  // 10. Scan Transparent check item.
  await H.menu('[data-test="explorer-object-scan-row"]')
  const was = await page.$eval('[data-test="explorer-scan-transparent"]', e => e.getAttribute('aria-checked'))
  await H.choose('explorer-scan-transparent')
  await H.menu('[data-test="explorer-object-scan-row"]')
  const now = await page.$eval('[data-test="explorer-scan-transparent"]', e => e.getAttribute('aria-checked'))
  await H.closeMenu()
  record(was !== now, `scan Transparent toggles (${was} → ${now})`)

  // 11. Body hidden from its eye, sketch hidden, then save.
  await page.click(`[data-test="explorer-body-row-${body}"] .explorer-checkbox`)
  await sleep(200)
  record(!(await H.bodies())[0].visible, 'body eye hides the body')
  const cdp = await page.createCDPSession()
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: out })
  await page.click('[data-test="save-project"]')
  for (let n = 0; n < 160 && !readdirSync(out).some(x => x.endsWith('.scanruler')); n++) await sleep(250)
  savedFile = readdirSync(out).find(x => x.endsWith('.scanruler'))
  record(Boolean(savedFile), `project saved (${savedFile})`)
} catch (error) { record(false, error.stack) }

// 12. Reopen in a fresh page and repeat the workflows.
if (savedFile) {
  const p2 = await browser.newPage()
  p2.on('pageerror', e => consoleErrors.push(e.message))
  await p2.setViewport({ width: 1500, height: 950 })
  const H2 = helpers(p2)
  try {
    await p2.goto(APP_URL, { waitUntil: 'networkidle0' })
    const bytes = [...readFileSync(resolve(out, savedFile))]
    await p2.evaluate(data => { const t = new DataTransfer(); t.items.add(new File([new Uint8Array(data)], 'explorer-parity.scanruler')); window.dispatchEvent(new DragEvent('drop', { dataTransfer: t, bubbles: true, cancelable: true })) }, bytes)
    await p2.waitForFunction(() => document.body.textContent.includes('Project opened'), { timeout: 120000 })
    await openReverse(p2)
    await H2.built()
    const { plane, sketch, extrude } = ids
    const f = await H2.feats(), b = await H2.bodies()
    record(f.on.some(([id, n]) => id === sketch && n === 'Profile') && f.on.some(([id, n]) => id === extrude && n === 'Wall'), 'reopen keeps both renames')
    record(b[0]?.color === '#2299ff', `reopen keeps the body colour (${b[0]?.color})`)
    record(b[0] && !b[0].visible, 'reopen keeps the body hidden')
    record(await H2.re(id => window.__scanruler.measure.getState().elements.find(e => e.id === id)?.color === '#33cc66', plane), 'reopen keeps the plane colour')
    const histSketch = `[data-test="explorer-history-feature-${sketch}"]`, histExtrude = `[data-test="explorer-history-feature-${extrude}"]`
    await H2.menu(histSketch); await H2.choose('explorer-disable-all-next'); await sleep(500)
    record((await H2.feats()).back.includes(extrude), 'after reopen: Disable All Next works')
    await H2.menu(histExtrude); await H2.choose('explorer-enable-to-here'); await sleep(500)
    record((await H2.feats()).back.length === 0, 'after reopen: Enable To Here works')
    await p2.click(histSketch)
    await p2.waitForSelector('[data-test="explorer-dependency-card"]')
    record(await p2.$eval('[data-test="explorer-dependency-card"]', e => e.textContent.includes('Wall')), 'after reopen: dependency card names the child')
    await p2.click(histExtrude); await p2.keyboard.press('F2')
    await p2.waitForSelector('[data-test="explorer-rename-input"]')
    await p2.keyboard.down('Control'); await p2.keyboard.press('a'); await p2.keyboard.up('Control')
    await p2.keyboard.type('Wall 2'); await p2.keyboard.press('Enter'); await sleep(300)
    record((await H2.feats()).on.some(([id, n]) => id === extrude && n === 'Wall 2'), 'after reopen: F2 rename works')
    await H2.menu(histSketch); await H2.choose('explorer-delete')
    await p2.waitForSelector('[data-test="explorer-delete-also"]')
    await p2.click('[data-test="explorer-delete-yes"]'); await sleep(500)
    record((await H2.feats()).on.length === 0, 'after reopen: delete with dependents works')
    await H2.undo()
    record((await H2.feats()).on.length === 2, 'after reopen: Undo restores')
    await p2.screenshot({ path: resolve(out, '05-after-reopen.png') })
  } catch (error) { record(false, `reopen: ${error.stack}`) }
}
writeFileSync(resolve(out, 'results.json'), JSON.stringify(results, null, 2))
await finish(browser, consoleErrors)
