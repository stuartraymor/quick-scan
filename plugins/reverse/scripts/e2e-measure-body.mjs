// SPDX-License-Identifier: AGPL-3.0-only
// Build known CAD fixtures through the store. All measurement actions go through the viewport and UI.
import { check, click, finish, launchApp, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { openReverse, reverseHelpers } from './lib.mjs'

const { browser, page, consoleErrors } = await launchApp({ width: 1500, height: 960 })
const { screen } = reverseHelpers(page)
const rows = () => page.$$eval('[data-test=measure-readout]:first-child [data-test=measure-row]', es =>
  es.map(e => [e.dataset.label, e.dataset.value]))
async function pick(point, marker = false) {
  const [x, y] = await screen(point)
  if (await page.evaluate(([x,y]) => document.elementFromPoint(x,y)?.tagName, [x,y]) !== 'CANVAS') throw Error('Point covered: ' + JSON.stringify({point,x,y}))
  await page.mouse.move(x,y)
  if (marker) await page.waitForSelector('[data-test=measure-preview-point]', { timeout: 2500 })
  await page.mouse.click(x,y)
  await sleep(180)
}
const expectRow = async (name, value) => {
  const current = await rows()
  check(current.some(([k,v]) => k === name && Math.abs(Number(v)-value)<1e-7), name + ' = ' + value + ': ' + JSON.stringify(current))
}
const clear = () => click(page, '[data-test=measure-delete-all]')
try {
  await openReverse(page)
  for (const kind of ['rectangle','circle']) {
    await page.evaluate(kind => {
      const s = () => window.__re.store.getState()
      const z = kind === 'rectangle' ? 0 : 10
      s().startSketch({kind:'world',axis:'z',offset:z},{origin:[0,0,z],normal:[0,0,1],basisU:[1,0,0],basisV:[0,1,0]})
      s().setSketchTool(kind)
      const points = kind === 'rectangle' ? [[-20,-10],[20,10]] : [[6,2],[9,2]]
      for (const p of points) s().sketchClick(p,0.01,false,{off:true})
      const id=s().commitSketch()
      s().startExtrude(id)
      if (!s().extrudeDraft.regions.length) s().pickAllDraftRegions()
      s().setExtrude({op:kind==='rectangle'?'new':'join',extent:{kind:'distance',from:0,to:kind==='rectangle'?10:5}})
      s().commitExtrude()
    },kind)
    await page.waitForFunction(() => !window.__re.store.getState().building && window.__re.store.getState().bodies.length > 0)
    await sleep(700)
  }
  await page.evaluate(() => {const s=window.__re.store.getState();for(const f of s.features) if(f.kind==='sketch'&&f.visible)s.toggleFeatureVisible(f.id)})
  if (await page.$('[data-test=support-card] .sc-x')) await click(page,'[data-test=support-card] .sc-x')
  for(const button of await page.$$('button')) if(await button.evaluate(e=>e.textContent.trim()==='Analysis')) {await button.click();break}
  await page.keyboard.press('a')
  await page.keyboard.press('1')
  await sleep(800)
  await click(page,'[data-test=ribbon-measure]')
  check(await page.$eval('[data-test=measure-adaptive]', el=>el.getAttribute('aria-pressed')==='true'),'Automatic opens on CAD bodies without a scan')
  const before=await page.evaluate(()=>JSON.stringify(window.__re.store.getState().features))
  await pick([0,-10,10],true)
  check((await rows()).some(([k,v])=>k==='Position (world XYZ)'&&v.split(',').every((n,i)=>Math.abs(Number(n)-[0,-10,10][i])<1e-8)),'straight edge midpoint reports its model position')
  await pick([6,2,15],true)
  await expectRow('Straight-line distance (3D)',Math.sqrt(205))
  await clear()
  await pick([6,2,15],true)
  check(await page.$eval('[data-test=measure-readout] b',e=>e.textContent.includes('Circle center')),'circular edge center is named in the result')
  await pick([0,-10,10],true)
  await expectRow('Straight-line distance (3D)',Math.sqrt(205))
  await clear()
  await pick([6+3*Math.cos(0.7),2+3*Math.sin(0.7),15])
  await expectRow('Diameter',6)
  await clear()
  await pick([6,5,15],true)
  check(await page.$eval('[data-test=measure-readout] b',e=>e.textContent.includes('Circle quadrant')),'a top rim quadrant is picked as a 3D point')
  await clear()
  await pick([-7,-10,10])
  await expectRow('Edge length',40)
  await pick([5,10,10])
  await expectRow('Minimum distance',20)
  await clear()
  await pick([-8,1,10])
  await expectRow('Face area',800-9*Math.PI)
  check(await page.evaluate(()=>JSON.stringify(window.__re.store.getState().features))===before,'mouse inspection preserves model and feature selection inputs')
  await page.screenshot({path:shotPath('measure-solid.png')})
  await click(page,'[data-test=measure-close]')
  await click(page,'[data-test=workspace-reverse]')
  await page.evaluate(()=>window.__re.store.getState().startSketch({kind:'world',axis:'z',offset:18},
    {origin:[0,0,18],normal:[0,0,1],basisU:[1,0,0],basisV:[0,1,0]},[{kind:'line',a:[-25,-3],b:[9,-3]}]))
  await click(page,'[data-test=sketch-part-full]')
  await click(page,'[data-test=sketch-open-measure]')
  await sleep(650)
  await pick([-8,-3,18],true)
  await pick([6,2,15],true)
  await expectRow('Straight-line distance (3D)',Math.sqrt(230))
  check(await page.evaluate(()=>window.__re.store.getState().sketchDraft?.sketch.entities.length===1),'sketch stays editable after measuring from its midpoint to a solid center')
  await click(page,'[data-test=measure-close]')
} catch(error) {check(false,error.stack ?? String(error))} finally {await finish(browser,consoleErrors)}
