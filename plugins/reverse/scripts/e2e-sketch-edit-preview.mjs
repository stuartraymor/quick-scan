// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {launchApp,sleep,OUT_DIR} from '../../../scripts/e2e-lib.mjs';
import {openReverse} from './lib.mjs';
const out=OUT_DIR;
const native={baseline:[{kind:'line',a:[12,6.6],b:[18.3,5.15]},{kind:'line',a:[12,-0.6],b:[17.2,-2.9]}]};
const {browser,page,consoleErrors}=await launchApp({width:1800,height:1100});
const read=()=>page.evaluate(()=>{const d=window.__re.store.getState().sketchDraft;return {sketch:d.sketch,history:d.history.length,error:d.error}});
const click=async s=>{await page.$eval(`[data-test=${s}]`,e=>e.click());await sleep(100)};
const seed=async()=>{await page.evaluate(es=>{const r=window.__re.store;r.setState({sketchDraft:null});r.getState().startSketch({kind:'world',axis:'z',offset:0},{origin:[0,0,0],normal:[0,0,1],basisU:[1,0,0],basisV:[0,1,0]},es)},native.baseline);await click('sketch-tool-select');};
const select=async pair=>page.evaluate(pair=>{const r=window.__re.store,d=r.getState().sketchDraft;r.setState({sketchDraft:{...d,selection:d.sketch.entities.slice(0,pair?2:1).map(e=>e.id)}})},pair);
const setInput=async(s,v)=>{const el=await page.$(`[data-test=${s}]`);await el.focus();await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');await page.keyboard.type(String(v));await sleep(150)};
const ghost=()=>page.$eval('[data-test=sketch-edit-preview] path',e=>e.getAttribute('d'));
const results={};
try{
 await openReverse(page);
 for(const mode of ['duplicate','offset']){
  await seed();await select(false);const before=await read();await click(mode==='duplicate'?'sketch-duplicate':'sketch-offset-entities');await sleep(200);
  assert.deepEqual(await read(),before);const first=await ghost();assert.ok(first?.length>20);
  if(mode==='duplicate'){assert.equal(await page.$eval('[data-test=sketch-duplicate-x]',e=>e.value),'10');assert.equal(await page.$eval('[data-test=sketch-duplicate-y]',e=>e.value),'0')}
  await setInput(mode==='duplicate'?'sketch-duplicate-x':'sketch-offset-distance',mode==='duplicate'?12:2);assert.notEqual(await ghost(),first);assert.deepEqual(await read(),before);
  await page.screenshot({path:out+'/'+mode+'-preview.png'});
  await page.$$eval('[data-test=sketch-edit-values] button',es=>es.find(e=>e.textContent==='Cancel').click());assert.equal(await page.$('[data-test=sketch-edit-preview]'),null);assert.deepEqual(await read(),before);
  await click(mode==='duplicate'?'sketch-duplicate':'sketch-offset-entities');await click('sketch-edit-apply');const after=await read();assert.equal(after.sketch.entities.length,3);assert.equal(after.history,before.history+1);assert.equal(await page.$('[data-test=sketch-edit-preview]'),null);
  if(mode==='duplicate'){const e=after.sketch.entities[2];assert.ok(Math.abs(e.a[0]-before.sketch.entities[0].a[0]-12)<1e-8);assert.equal(e.a[1],before.sketch.entities[0].a[1]);}
  await click('undo');assert.deepEqual((await read()).sketch,before.sketch);await click('redo');assert.deepEqual((await read()).sketch,after.sketch);
  await select(false);await click(mode==='duplicate'?'sketch-duplicate':'sketch-offset-entities');await click('sketch-tool-line');assert.equal(await page.$('[data-test=sketch-edit-preview]'),null);
  await click('sketch-tool-select');await select(false);await click(mode==='duplicate'?'sketch-duplicate':'sketch-offset-entities');await page.keyboard.press('Escape');assert.equal(await page.$('[data-test=sketch-edit-values]'),null);assert.equal(await page.$('[data-test=sketch-edit-preview]'),null);results[mode]={pass:true,before,after};console.log('PASS',mode,'live preview, parameters, Cancel, Apply, Undo/Redo, tool change');
 }
 assert.deepEqual(consoleErrors,[]);fs.writeFileSync(out+'/graphics-results.json',JSON.stringify(results,null,2));
}catch(e){await page.screenshot({path:out+'/graphics-failure.png'});throw e}finally{await browser.close()}
