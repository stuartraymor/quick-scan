// SPDX-License-Identifier: AGPL-3.0-only
// The rest of the Objects/History menus, through the real UI: group rows,
// several rows selected, a body's rename and default colour, Transparent,
// the scan's Properties, End of Model's own menu, and Delete refused while
// rolled back. Fixture objects come from store actions; every action under
// test is a click or a key press.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { launchApp, loadScan, repoFile, check, finish, sleep, MOD } from '../../../scripts/e2e-lib.mjs'
import { openReverse } from './lib.mjs'

const out = process.env.OUT_DIR ?? resolve('../../analysis/quick-scan-v1.2.14/gui')
mkdirSync(out, { recursive: true })
const { browser, page, consoleErrors } = await launchApp({ protocolTimeout: 240000 })
const results = []
const record = (ok, label) => { check(ok, label); results.push({ ok: Boolean(ok), label }) }
const re = (fn, ...a) => page.evaluate(fn, ...a)
const labels = () => page.$$eval('.explorer-core-menu .explorer-core-menu-label', es => es.map(e => e.textContent))
const menu = async sel => { await page.waitForSelector(sel, { visible: true }); await page.click(sel, { button: 'right' }); await page.waitForSelector('.explorer-core-menu', { visible: true }); return labels() }
const choose = async id => { await page.click(`.explorer-core-menu [data-test="${id}"]`); await sleep(200) }
const closeMenu = async () => { if (await page.$('.explorer-core-menu')) { await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.explorer-core-menu')) } }
const undo = async () => { await page.click('[data-test="undo"], [data-test="ribbon-undo"]'); await sleep(300) }
const planes = () => re(() => window.__scanruler.measure.getState().elements.map(e => ({ id: e.id, visible: e.visible, color: e.color })))
const pickColor = async hex => { await page.waitForSelector('[data-test="explorer-color-input"]'); await page.$eval('[data-test="explorer-color-input"]', (e, hex) => { e.value = hex; e.dispatchEvent(new Event('change', { bubbles: true })) }, hex); await sleep(300) }

try {
  await loadScan(page, process.env.SCAN ?? repoFile('public/reference-examples/basic_part.stl'))
  await openReverse(page)
  const ids = await re(() => {
    const m = () => window.__scanruler.measure.getState()
    const made = []
    for (const [name, z] of [['Datum A', 0], ['Datum B', 5]]) {
      m().startDraft('plane'); m().setDraftMethod('plane-coords'); m().setDraftParams([0, 0, 1, m().modelCenter[0], m().modelCenter[1], m().modelCenter[2] + z]); m().setDraftName(name)
      made.push(m().commitDraft()); m().cancelDraft?.()
    }
    const XY = { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }
    const r = () => window.__re.store.getState()
    r().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY); r().setSketchTool('rectangle')
    r().sketchClick([-10, -10], 0.5, false, { off: true }); r().sketchClick([10, 10], 0.5, false, { off: true })
    const sketch = r().commitSketch(); r().startExtrude(sketch); const extrude = r().commitExtrude()
    return { a: made[0], b: made[1], sketch, extrude }
  })
  await page.waitForFunction(() => !window.__re.store.getState().building && window.__re.store.getState().bodies.length > 0, { timeout: 180000 })
  const body = await re(() => window.__re.store.getState().bodies[0].id)
  const rowA = `[data-test="explorer-element-${ids.a}"]`, rowB = `[data-test="explorer-element-${ids.b}"]`
  record(ids.a && ids.b && ids.extrude, `fixture ${JSON.stringify({ ...ids, body })}`)

  // Group row: Planes.
  let l = await menu('[data-test="explorer-plane-group"] > summary')
  record(['Show All', 'Hide All', 'Color ...', 'Delete ...'].every(x => l.includes(x)), `Planes group menu: ${l.join(' | ')}`)
  await choose('explorer-group-hide')
  record((await planes()).every(p => !p.visible), 'group Hide All hides both planes')
  await menu('[data-test="explorer-plane-group"] > summary'); await choose('explorer-group-show')
  record((await planes()).every(p => p.visible), 'group Show All shows them')
  await menu('[data-test="explorer-plane-group"] > summary'); await choose('explorer-group-color'); await pickColor('#aa33ff')
  record((await planes()).every(p => p.color === '#aa33ff'), 'group Color recolours both planes')
  await undo()
  record((await planes()).every(p => p.color !== '#aa33ff'), 'one Undo reverts both colours')

  // Several rows selected.
  await page.click(rowA)
  await page.keyboard.down(MOD); await page.click(rowB); await page.keyboard.up(MOD)
  l = await menu(rowB)
  record(['Hide All But This', 'Hide', 'Show', 'Color ...', 'Delete ...'].every(x => l.includes(x)) && !l.includes('Rename ...'), `multi-select menu: ${l.join(' | ')}`)
  await choose('explorer-multi-hide')
  record((await planes()).every(p => !p.visible), 'multi Hide hides both selected planes')
  await undo()
  record((await planes()).every(p => p.visible), 'one Undo shows both again')
  await page.click(rowA); await page.keyboard.down(MOD); await page.click(rowB); await page.keyboard.up(MOD)
  await page.keyboard.press('Delete')
  await page.waitForSelector('[data-test="explorer-delete-confirm"]')
  const asked = await page.$eval('[data-test="explorer-delete-asked"]', e => e.textContent)
  const names = await re(() => window.__scanruler.measure.getState().elements.map(e => e.name))
  record(names.length === 2 && names.every(n => asked.includes(n)), `Delete key with two rows selected asks for both: "${asked}"`)
  await page.click('[data-test="explorer-delete-yes"]'); await sleep(300)
  record((await planes()).length === 0, 'Yes deletes both planes')
  await undo()
  record((await planes()).length === 2, 'one Undo restores both planes')

  // Bodies: group menu, Transparent, F2 rename, Set Default Color.
  l = await menu('[data-test="explorer-solids"] > summary')
  record(['Show All', 'Hide All', 'Color ...', 'Set Default Color', 'Transparent', 'Delete ...'].every(x => l.includes(x)), `Solids group menu: ${l.join(' | ')}`)
  const seeBefore = await re(() => window.__re.store.getState().bodiesSeeThrough)
  await choose('explorer-group-transparent')
  record(await re(() => window.__re.store.getState().bodiesSeeThrough) !== seeBefore, 'Solids Transparent makes the bodies see-through')
  await menu('[data-test="explorer-solids"] > summary'); await choose('explorer-group-transparent')
  await page.click(`[data-test="explorer-body-${body}"]`)
  await page.keyboard.press('F2')
  await page.waitForSelector('[data-test="explorer-rename-input"]')
  await page.keyboard.down(MOD); await page.keyboard.press('a'); await page.keyboard.up(MOD)
  await page.keyboard.type('Housing'); await page.keyboard.press('Enter'); await sleep(300)
  record(await re(() => window.__re.store.getState().bodies[0].name === 'Housing'), 'F2 renames a body')
  const defaultColor = await re(() => window.__re.store.getState().bodies[0].color)
  await menu(`[data-test="explorer-body-${body}"]`); await choose('explorer-body-color'); await pickColor('#ff8800')
  await menu(`[data-test="explorer-body-${body}"]`); await choose('explorer-body-default-color')
  record(await re(c => window.__re.store.getState().bodies[0].color === c && !window.__re.store.getState().bodyStyles[window.__re.store.getState().bodies[0].id]?.color, defaultColor), 'Set Default Color puts the body back to its own colour')

  // Sketches group.
  l = await menu('[data-test="explorer-sketches"] > summary')
  record(l.includes('Show All') && l.includes('Hide All'), `Sketches group menu: ${l.join(' | ')}`)
  await choose('explorer-group-show')
  record(await re(() => window.__re.store.getState().features.filter(f => f.kind === 'sketch').every(f => f.visible)), 'Sketches Show All shows the sketch')

  // Scan Properties, Hide / Show.
  await menu('[data-test="explorer-object-scan-row"]'); await choose('explorer-scan-properties')
  await page.waitForSelector('[data-test="explorer-properties"]')
  const sp = await page.$eval('[data-test="explorer-properties"]', e => e.textContent)
  record(sp.includes('Triangles') && sp.includes('213,448'), 'scan Properties shows its triangles')
  await page.screenshot({ path: resolve(out, '06-scan-properties.png') })
  await page.click('[data-test="explorer-properties-ok"]')
  await menu('[data-test="explorer-object-scan-row"]'); await choose('explorer-scan-visibility')
  record(!(await page.$eval('[data-test="explorer-object-scan-row"] .explorer-checkbox', e => e.checked)), 'scan Hide hides the scan')
  await menu('[data-test="explorer-object-scan-row"]'); await choose('explorer-scan-visibility')
  record(await page.$eval('[data-test="explorer-object-scan-row"] .explorer-checkbox', e => e.checked), 'scan Show shows it again')

  // End of Model's menu, and Delete refused while rolled back.
  await closeMenu()
  await page.$eval('[data-test="explorer-end-model"]', e => e.scrollIntoView({ block: 'center' }))
  await sleep(200)
  l = await menu('[data-test="explorer-end-model"]')
  record(l.includes('Place at Start') && l.includes('Place at End'), `End of Model menu: ${l.join(' | ')}`)
  await choose('explorer-end-start'); await sleep(400)
  const st = await page.$$eval('.explorer-history-panel .explorer-row.is-rolled', rows => rows.length)
  record(st === 4 && await re(() => window.__re.store.getState().features.length === 0 && window.__scanruler.measure.getState().elements.length === 0), `Place at Start keeps only the scan (${st} History rows rolled back)`)
  await menu(`[data-test="explorer-history-feature-${ids.sketch}"]`)
  const del = await page.$eval('.explorer-core-menu [data-test="explorer-delete"]', e => e.disabled)
  await closeMenu()
  await page.click(`[data-test="explorer-history-feature-${ids.sketch}"]`)
  await page.keyboard.press('Delete')
  await page.waitForSelector('[data-test="explorer-delete-confirm"]')
  const blocked = await page.$eval('[data-test="explorer-delete-blocked"]', e => e.textContent).catch(() => '')
  record(del && blocked.includes('rolled back'), `rolled back: Delete is greyed in the menu and the Delete key explains: "${blocked}"`)
  await page.click('[data-test="explorer-delete-no"]')
  await menu('[data-test="explorer-end-model"]'); await choose('explorer-end-end')
  await page.waitForFunction(() => !window.__re.store.getState().building && window.__re.store.getState().bodies.length > 0, { timeout: 180000 })
  record(await re(() => window.__re.store.getState().features.length === 2 && window.__scanruler.measure.getState().elements.length === 2), 'Place at End builds everything again')
  await page.screenshot({ path: resolve(out, '07-after-place-at-end.png') })

  // A sketch on a datum plane: deleting the plane lists the sketch, and Yes
  // takes both, so no feature is left on a missing plane.
  const onB = await re(b => {
    const r = () => window.__re.store.getState()
    const XY = { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }
    r().startSketch({ kind: 'plane', id: b }, XY); r().setSketchTool('rectangle')
    r().sketchClick([-5, -5], 0.5, false, { off: true }); r().sketchClick([5, 5], 0.5, false, { off: true })
    return r().commitSketch()
  }, ids.b)
  const onBName = await re(id => window.__re.store.getState().features.find(f => f.id === id)?.name, onB)
  await menu(rowB); await choose('explorer-core-delete')
  await page.waitForSelector('[data-test="explorer-delete-confirm"]')
  const alsoB = await page.$eval('[data-test="explorer-delete-also"]', e => e.textContent).catch(() => '')
  record(onB && alsoB.includes(onBName), `deleting a datum plane lists the sketch drawn on it: "${alsoB}"`)
  await page.click('[data-test="explorer-delete-yes"]'); await sleep(500)
  record(await re((b, s) => !window.__scanruler.measure.getState().elements.some(e => e.id === b) && !window.__re.store.getState().features.some(f => f.id === s), ids.b, onB), 'Yes deletes the plane and the sketch on it')
  await undo()
  record(await re((b, s) => window.__scanruler.measure.getState().elements.some(e => e.id === b) && window.__re.store.getState().features.some(f => f.id === s), ids.b, onB), 'one Undo restores the plane and the sketch')
} catch (error) { record(false, error.stack) }
writeFileSync(resolve(out, 'results-2.json'), JSON.stringify(results, null, 2))
await finish(browser, consoleErrors)
