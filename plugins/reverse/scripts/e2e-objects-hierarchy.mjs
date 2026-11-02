// SPDX-License-Identifier: AGPL-3.0-only
// Core and CAD fixture setup uses real stores/kernel. Tree changes use UI input.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { launchApp, loadScan, repoFile, check, fail, finish, shotPath } from '../../../scripts/e2e-lib.mjs'
import { openReverse } from './lib.mjs'

const { browser, page, consoleErrors } = await launchApp({ protocolTimeout: 180000 })
const results = []
const record = (ok, label) => { check(ok, label); results.push({ ok: Boolean(ok), label }) }
const checkbox = selector => page.$eval(selector, e => ({ checked: e.checked, mixed: e.indeterminate, disabled: e.disabled }))
const all = '[data-test=explorer-all-visible]'
const coreGroup = '[data-test=explorer-plane-group] > summary input'
const snapshot = () => page.evaluate(() => {
  const core = window.__scanruler.measure.getState(), reverse = window.__re.store.getState()
  return JSON.stringify({ elements: core.elements.map(({ visible, ...element }) => element), sections: core.sections.map(({ visible, ...section }) => section), features: reverse.features.map(({ visible, ...feature }) => feature), triangles: core.triangleCount, buildVersion: reverse.buildVersion })
})
try {
  await loadScan(page, repoFile(process.env.SCAN ?? 'public/reference-examples/basic_part.stl'))
  const planes = await page.evaluate(() => {
    const s = window.__scanruler.measure.getState(), ids = []
    for (const offset of [0, 3]) { s.startDraft('plane'); s.setDraftMethod('plane-coords'); s.setDraftParams([0,0,1,0,0,offset]); ids.push(s.commitDraft()); s.cancelDraft() }
    s.toggleElementVisible(ids[1])
    return ids
  })
  await openReverse(page)
  const sketch = await page.evaluate(async () => {
    const { emptySketch, addRectangle } = await import('/plugins/reverse/core/sketch.ts')
    const s = window.__re.store.getState()
    s.startSketch({ kind:'world',axis:'z',offset:0 }, {origin:[0,0,0],normal:[0,0,1],basisU:[1,0,0],basisV:[0,1,0]})
    const sketch = emptySketch(); addRectangle(sketch,[0,0],[12,8]); s.setSketch(sketch)
    return s.commitSketch()
  })
  await page.evaluate(id => { const s=window.__re.store.getState(); s.startExtrude(id); s.setExtrude({op:'new',extent:{kind:'distance',from:0,to:5}}); s.commitExtrude() },sketch)
  await page.waitForFunction(() => !window.__re.store.getState().building && window.__re.store.getState().bodies.some(b=>!b.surface), {timeout:120000})
  await page.evaluate(id => { const s=window.__re.store.getState(); s.startFeature('sheet',{sketchId:id,from:0,to:7}); s.commitFeature() },sketch)
  await page.waitForFunction(() => !window.__re.store.getState().building && window.__re.store.getState().bodies.some(b=>b.surface), {timeout:120000})
  const before = await snapshot()
  record(await page.$eval('[data-test=explorer-meshes] > summary',e=>e.textContent==='Meshes(1)'), 'scan appears in true Meshes(1) group')
  record(await page.$eval('[data-test=explorer-plane-group] > summary',e=>e.textContent==='Planes(2)'), 'core planes are grouped by actual kind with truthful count')
  record(await page.$eval('[data-test=explorer-sketches] > summary',e=>e.textContent==='Sketches(1)'), 'real editable CAD sketch appears in Sketches(1)')
  record(await page.$('[data-test=explorer-surfaces]') && await page.$('[data-test=explorer-solids]'), 'real kernel surfaces and solids have separate groups')
  const inputFile = (process.env.SCAN ?? 'public/reference-examples/basic_part.stl').split('/').pop()
  const sample = JSON.parse(readFileSync(repoFile('src/app/referenceExamples.json'), 'utf8')).find(item => item.file === inputFile)
  if (!sample) throw Error('Expected a cataloged comparison sample')
  record(await page.$eval('[data-test=explorer-meshes] .explorer-item', (e, expected) => e.textContent.trim() === expected, `${sample.file.replace(/\.[^.]+$/, '')} (T: ${sample.triangles.toLocaleString()})`), 'mesh row uses catalog basename and actual triangle count')
  record((await checkbox(coreGroup)).mixed, 'mixed plane visibility is represented by native indeterminate category checkbox')
  record((await checkbox(all)).mixed, 'ALL aggregates mixed visibility from core and CAD objects')
  await page.click(coreGroup)
  record(await page.evaluate(()=>window.__scanruler.measure.getState().elements.every(e=>e.visible)), 'clicking mixed plane category shows both real planes')
  await page.click(coreGroup)
  record(await page.evaluate(()=>window.__scanruler.measure.getState().elements.every(e=>!e.visible)), 'unchecking plane category hides both planes')
  const coords='.explorer-coordinate input'
  await page.click(coords)
  record((await checkbox(coords)).checked, 'Coordinate System is an independent direct checkbox leaf')
  await page.click(all)
  record((await checkbox(all)).checked && !(await checkbox(all)).mixed, 'ALL shows scan, core planes, sketch, surfaces and solids together')
  record(await page.evaluate(()=>{const s=window.__re.store.getState();return s.bodies.every(b=>b.visible)&&s.features.filter(f=>f.kind==='sketch').every(f=>f.visible)}), 'ALL reaches real plugin-owned object visibility')
  await page.click(all)
  record(!(await checkbox(all)).checked && !(await checkbox(all)).mixed, 'ALL uncheck hides every model object')
  record((await checkbox(coords)).checked, 'ALL hide preserves independent coordinate-system display')
  record(await page.evaluate(()=>window.__re.store.getState().features.every(f=>!f.suppressed)), 'visibility changes never suppress CAD features')
  await page.click(all)
  await page.evaluate(()=>{ window.__scanruler.measure.getState().setElementsHidden(true); window.__re.store.getState().setBodiesHidden(true); window.__re.store.getState().setElementsShown(false) })
  record((await checkbox(all)).mixed && !(await checkbox('[data-test=explorer-solids] > summary input')).checked, 'explicit core and CAD masks are reflected in category and ALL states')
  await page.click(all)
  record(await page.evaluate(()=>!window.__scanruler.measure.getState().elementsHidden&&!window.__re.store.getState().bodiesHidden&&window.__re.store.getState().elementsShown), 'ALL show resolves global visibility masks without rebuilding geometry')
  record((await checkbox(all)).checked, 'ALL becomes fully checked after masks are resolved')
  const row=`[data-test=explorer-element-${planes[0]}]`
  await page.click(row,{button:'right'});await page.click('[data-test=explorer-core-edit]')
  await page.waitForSelector('[data-test=cancel-draft]',{visible:true})
  record(await page.evaluate(id=>window.__scanruler.measure.getState().draft?.editId===id,planes[0]), 'compact plane row retains real context Edit identity')
  record((await checkbox(all)).disabled && (await checkbox(coreGroup)).disabled, 'ALL and categories are guarded while core editing is active')
  await page.click('[data-test=cancel-draft]')
  await page.evaluate(async()=>{const {useShell}=await import('/src/state/shellStore.ts');useShell.getState().setExtractOpen(true)})
  record((await checkbox(all)).disabled, 'ALL is disabled while extraction holds work')
  await page.evaluate(async()=>{const {useShell}=await import('/src/state/shellStore.ts');useShell.getState().setExtractOpen(false)})
  await page.click(`[data-test=explorer-object-feature-${sketch}]`,{button:'right'})
  await page.click('.explorer-feature-menu [role=menuitem]')
  await page.waitForSelector('[data-test=sketch-cancel]',{visible:true})
  record((await checkbox(all)).disabled && (await checkbox(coreGroup)).disabled, 'plugin sketch editor also locks global and core visibility mutations')
  await page.click('[data-test=sketch-cancel]')
  await page.waitForFunction(()=>!window.__re.store.getState().building)
  // Reopening an editor legitimately increments buildVersion; compare geometry separately.
  const after=await snapshot()
  record(JSON.parse(before).triangles===JSON.parse(after).triangles && JSON.stringify(JSON.parse(before).elements)===JSON.stringify(JSON.parse(after).elements) && JSON.stringify(JSON.parse(before).features)===JSON.stringify(JSON.parse(after).features), 'hierarchy/visibility operations and canceled edits preserve original geometry and feature recipes')
  await page.click('[aria-label="Collapse all object groups"]')
  record(await page.$$eval('.explorer-objects details',groups=>groups.every(g=>!g.open)), 'collapse toolbar closes real object groups')
  await page.click('[aria-label="Expand all object groups"]')
  record(await page.$$eval('.explorer-objects details',groups=>groups.every(g=>g.open)), 'expand toolbar restores real object groups')
  const out=resolve(process.env.SHOT_DIR??'e2e-out');mkdirSync(out,{recursive:true})
  await (await page.createCDPSession()).send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:out})
  await page.click('[data-test=save-project]')
  for(let n=0;n<120&&!readdirSync(out).some(f=>f.endsWith('.scanruler'));n++)await new Promise(done=>setTimeout(done,250))
  record(readdirSync(out).some(f=>f.endsWith('.scanruler')), 'real mixed core/CAD fixture saved for installed replay')
  await page.screenshot({path:shotPath('objects-hierarchy.png')})
}catch(error){fail(error.stack??String(error))}finally{writeFileSync(shotPath('objects-hierarchy-results.json'),JSON.stringify(results,null,2));await finish(browser,consoleErrors)}
