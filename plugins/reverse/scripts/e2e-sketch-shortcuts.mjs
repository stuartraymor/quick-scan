// SPDX-License-Identifier: AGPL-3.0-only
// Real key and pointer regression: a command must own both the toolbar and sheet.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { launchApp, click, sleep, shotPath } from '../../../scripts/e2e-lib.mjs'
import { openReverse } from './lib.mjs'
const {browser,page,consoleErrors}=await launchApp({width:1500,height:960})
const cases=[]
const state=()=>page.evaluate(()=>window.__re.store.getState().sketchDraft)
const seed=async(entities=[])=>{
  await page.evaluate(async es=>{
    const {closeSketchToolOverlays}=await import('/plugins/reverse/state/sketchToolActions.ts');closeSketchToolOverlays()
    window.__re.store.getState().startSketch({kind:'world',axis:'z',offset:0},{origin:[0,0,0],normal:[0,0,1],basisU:[1,0,0],basisV:[0,1,0]},es)
  },entities)
  await page.waitForSelector('[data-test=sketch-tool-select]');await click(page,'[data-test=sketch-tool-select]');await sleep(80)
}
const pick=async p=>{const q=await page.evaluate(p=>window.__re.sheet().sheetScreenPoint(p),p);await page.mouse.click(q.x,q.y);await sleep(50)}
const noOverlays=async()=>assert.equal(await page.$$eval('[data-test=sketch-extra-overlay],[data-test=sketch-fit-brush-overlay],[data-test=sketch-corner-trim-overlay],[data-test=sketch-project-overlay]',es=>es.length),0)
const undo=async()=>{await page.keyboard.down('Control');await page.keyboard.press('z');await page.keyboard.up('Control');await sleep(80)}
try {
 await openReverse(page);if(await page.$('[data-test=support-card] .sc-x'))await click(page,'[data-test=support-card] .sc-x')
 await seed()
 const [a,b,c]=await page.evaluate(()=>{const r=document.querySelector('[data-test=sketch-viewport]').getBoundingClientRect(),s=window.__re.sheet();const x=r.left+r.width*.68,y=r.top+r.height*.5;return [[x,y],[x+90,y],[x+45,y-65]].map(([x,y])=>s.sheetPoint(x,y))})
 for(const [button,key,kind] of [['sketch-trim','l','line'],['sketch-tool-slot','c','circle'],['sketch-extract','c','circle'],['sketch-sharpen','r','arc']]) {
   await seed();await click(page,`[data-test=${button}]`);const view=await page.evaluate(()=>window.__re.sheet().sheetView())
   await page.keyboard.press(key);await sleep(60);await noOverlays();assert.equal((await state()).tool,kind)
   assert.deepEqual(await page.evaluate(()=>window.__re.sheet().sheetView()),view)
   await pick(a);await pick(b);if(kind==='arc')await pick(c)
   let d=await state();assert.equal(d.sketch.entities.length,1);assert.equal(d.sketch.entities[0].kind,kind)
   await undo();assert.equal((await state()).sketch.entities.length,0);cases.push(`${button} -> ${key}: actual ${kind}, stable view, one undo`)
 }
 await seed([{kind:'line',a,b}]);await click(page,'[data-test=sketch-tool-project]');await page.keyboard.press('d');await sleep(60);await noOverlays();assert.equal((await state()).tool,'dimension');await pick([(a[0]+b[0])/2,a[1]]);assert.notEqual((await state()).dimMade,null);await page.keyboard.press('Escape');assert.equal((await state()).sketch.constraints.length,0);assert.equal((await state()).sketch.entities.length,1);cases.push('Project -> D, real pending dimension; Escape cancels dimension only')
 const x=a[0],y=a[1],w=b[0]-a[0]
 await seed([{kind:'line',a:[x,y],b:[x+w,y]},{kind:'line',a:[x+w*.3,y-w],b:[x+w*.3,y+w]},{kind:'line',a:[x+w*.7,y-w],b:[x+w*.7,y+w]}]);const before=(await state()).sketch
 await page.keyboard.press('t');await page.waitForSelector('[data-test=sketch-extra-overlay]');await pick([x+w*.5,y]);assert.equal((await state()).sketch.entities.length,4);await undo();assert.deepEqual((await state()).sketch,before);await page.keyboard.press('Escape');await noOverlays();cases.push('T trims actual internal span, one undo; Escape releases Trim')
 await seed([{kind:'line',a:[x,y-w],b:[x,y+w],construction:true},{kind:'line',a:[x+w*.3,y],b:[x+w*.6,y]}]);await page.evaluate(()=>{const s=window.__re.store; s.setState({sketchDraft:{...s.getState().sketchDraft,selection:s.getState().sketchDraft.sketch.entities.map(e=>e.id)}})})
 await page.keyboard.press('m');let d=await state();assert.equal(d.sketch.entities.length,3);assert.ok(Math.abs(d.sketch.entities.at(-1).a[0]-(x-w*.3))<1e-6);await undo();assert.equal((await state()).sketch.entities.length,2);cases.push('M mirrors selected geometry using construction axis and undoes')
 await seed([{kind:'line',a,b}]);await page.evaluate(()=>{const s=window.__re.store;s.setState({sketchDraft:{...s.getState().sketchDraft,selection:[s.getState().sketchDraft.sketch.entities[0].id]}})})
 await page.keyboard.press('o');await page.waitForSelector('[data-test=sketch-offset-distance]');await page.focus('[data-test=sketch-offset-distance]');await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');await page.keyboard.type('2');await click(page,'[data-test=sketch-edit-apply]');assert.equal((await state()).sketch.entities.length,2);assert.ok(Math.abs(Math.abs((await state()).sketch.entities.at(-1).a[1]-a[1])-2)<1e-6);await undo();assert.equal((await state()).sketch.entities.length,1);cases.push('O opens same offset panel; typed distance creates real offset and undoes')
 await seed([{kind:'line',a,b}]);await page.evaluate(()=>{const s=window.__re.store;s.setState({sketchDraft:{...s.getState().sketchDraft,selection:[s.getState().sketchDraft.sketch.entities[0].id]}})});await page.keyboard.press('o');await page.waitForSelector('[data-test=sketch-offset-distance]');await page.focus('[data-test=sketch-offset-distance]');await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');await page.keyboard.type('123');await page.keyboard.type('lcrdtmo');assert.equal((await state()).tool,'select');assert.equal(await page.$eval('[data-test=sketch-offset-distance]',e=>e.value),'123');await noOverlays();assert.equal(await page.$eval('[data-test=sketch-offset-distance]',e=>document.activeElement===e),true);cases.push('Command letters do not steal focus or activate tools while typing in offset field')
 await seed();await click(page,'[data-test=sketch-tool-select]');await page.keyboard.press('m');await page.keyboard.press('o');assert.equal((await state()).sketch.entities.length,0);assert.equal(await page.$('[data-test=sketch-edit-values]'),null);cases.push('M/O without selection are no-ops')
 await click(page,'[data-test=sketch-tool-polyline]');await page.keyboard.press('l');await pick(a);await pick(b);await pick(c);assert.equal((await state()).sketch.entities.length,1);cases.push('L leaves Polyline mode for single Line')
 await page.keyboard.press('Escape');const sketch=(await state()).sketch;await page.keyboard.press('Escape');assert.ok(await state());assert.deepEqual((await state()).sketch,sketch);cases.push('Layered Escape preserves completed sketch')
 assert.deepEqual(consoleErrors,[]);await page.screenshot({path:shotPath('sketch-shortcuts.png')});writeFileSync(shotPath('sketch-shortcuts.json'),JSON.stringify({passed:true,cases,consoleErrors},null,2));console.log('PASS',cases.join('\n'))
}catch(error){writeFileSync(shotPath('sketch-shortcuts.json'),JSON.stringify({passed:false,cases,error:String(error)},null,2));await page.screenshot({path:shotPath('sketch-shortcuts-failure.png')});throw error}finally{await browser.close()}
