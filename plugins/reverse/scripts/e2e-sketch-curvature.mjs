// SPDX-License-Identifier: AGPL-3.0-only
// 2D Sketch overhaul 6: the curvature comb from the true curvature. An R10
// arc is labelled R 10.000 mm (R 0.3937 in in inches) and a line gets no
// comb; Options change the density (fewer teeth drawn), the maximum length
// and the offset reference line; the comb and the tolerance analysis show
// together without their options clashing; turning it off clears it.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {launchApp,loadScan,sleep,shotPath} from '../../../scripts/e2e-lib.mjs';
import {openReverse} from './lib.mjs';
const out=shotPath('sketch-curvature');fs.mkdirSync(out,{recursive:true});
const mesh=[];for(const z of [-5,5])for(let i=0;i<160;i++){const a=i*Math.PI/80;mesh.push(`v ${10*Math.cos(a)} ${10*Math.sin(a)} ${z}`)}
mesh.push('v 0 0 -5','v 0 0 5');for(let i=0;i<160;i++){const a=i+1,b=(i+1)%160+1;mesh.push(`f ${a} ${b} ${b+160}`,`f ${a} ${b+160} ${a+160}`,`f 321 ${b} ${a}`,`f 322 ${a+160} ${b+160}`)}
const meshPath=out+'/cylinder.obj';fs.writeFileSync(meshPath,mesh.join('\n'));
const {browser,page,consoleErrors}=await launchApp({width:1700,height:1050});
const objects=()=>page.evaluate(()=>{let n=0;window.__re.sheet().elementGroup.traverse(o=>{if(o.material&&o.material.linewidth!==undefined)n++});return n});
const dashed=()=>page.evaluate(()=>{let n=0;window.__re.sheet().elementGroup.traverse(o=>{if(o.material?.dashed)n++});return n});
const labels=()=>page.$$eval('.viewport-label',es=>es.map(e=>e.textContent.trim()).filter(t=>/^R /.test(t)));
const type=async(test,v)=>{const el=await page.$(`[data-test=${test}]`);await el.focus();await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');await page.keyboard.type(String(v));await sleep(300)};
const click=async test=>{await page.$eval(`[data-test=${test}]`,e=>e.click());await sleep(300)};
const result={};
try{
 await loadScan(page,meshPath);await openReverse(page);
 const entities=[{kind:'line',a:[-30,-20],b:[30,-20]},{kind:'arc',c:[0,0],r:10,start:0,sweep:Math.PI}];
 await page.evaluate(async entities=>{const r=window.__re.store;r.setState({sketchDraft:null});r.getState().startSketch({kind:'world',axis:'z',offset:0},{origin:[0,0,0],normal:[0,0,1],basisU:[1,0,0],basisV:[0,1,0]},entities);},entities);await sleep(900);
 await page.evaluate(()=>window.__re.sheet().zoomTo?.([-40,-30,40,30]));await sleep(300);
 const plain=await objects();
 await click('sketch-curvature');
 const on=await objects();result.teethDrawn=on-plain;
 assert.ok(on-plain>=60,'comb drawn on the arc: '+(on-plain));
 assert.deepEqual(await labels(),['R 10.000 mm'],'smallest radius labelled');
 await page.screenshot({path:out+'/01-comb.png'});
 // Line only: no comb at all.
 await page.evaluate(()=>{const s=window.__re.store.getState();const sk=structuredClone(s.sketchDraft.sketch);sk.entities=sk.entities.filter(e=>e.kind==='line');s.setSketch(sk)});await sleep(300);
 assert.deepEqual(await labels(),[],'a line has no comb');
 await page.evaluate(()=>window.__re.store.getState().undoSketch());await sleep(300);
 // Options: density 20 draws fewer teeth; the offset line is dashed.
 await click('sketch-curvature-options');
 assert.ok(await page.$('[data-test=sketch-curvature-options-panel]'));
 await type('sketch-curvature-density',20);
 const fewer=await objects();result.teeth20=fewer-plain;
 assert.ok(fewer-plain<on-plain-30,'density 20 gives fewer teeth: '+(fewer-plain));
 const dashBefore=await dashed();await click('sketch-curvature-offset-on');
 assert.equal(await dashed(),dashBefore+1,'offset reference line drawn dashed');
 // Slider and Scale field stay in step.
 await page.$eval('[data-test=sketch-curvature-scale]',e=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(e,'120');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))});await sleep(300);
 assert.equal(await page.$eval('[data-test=sketch-curvature-scale-value]',e=>e.value),'120','field follows the slider');
 // Analysis at the same time: both option panels open, nothing lost.
 await click('sketch-analysis');await click('sketch-analysis-options');
 assert.ok(await page.$('[data-test=sketch-curvature-options-panel]')&&await page.$('[data-test=sketch-analysis-options-panel]'),'both option panels open');
 assert.deepEqual(await labels(),['R 10.000 mm']);
 await page.screenshot({path:out+'/02-comb-and-analysis.png'});
 await click('sketch-analysis');
 // Inches: label and max length follow.
 await page.click('[data-test="ribbon-tab-settings"]');await sleep(150);await page.click('[data-test="ribbon-inches"]');await sleep(400);
 assert.deepEqual(await labels(),['R 0.3937 in']);
 result.maxInches=await page.$eval('[data-test=sketch-curvature-max]',e=>e.value);
 assert.equal(Number(result.maxInches),Number((20/25.4).toFixed(6)),'max length in inches');
 await page.click('[data-test="ribbon-millimetres"]');await sleep(300);
 // Off: the comb is gone.
 await click('sketch-curvature');
 assert.equal(await objects(),plain,'off clears the comb');assert.deepEqual(await labels(),[]);
 fs.writeFileSync(out+'/result.json',JSON.stringify({passed:true,...result},null,2));
 assert.deepEqual(consoleErrors,[]);console.log('PASS curvature comb:',JSON.stringify(result));
}catch(e){await page.screenshot({path:out+'/failure.png'});console.log(await page.evaluate(()=>document.body.innerText.slice(-1200)));throw e;}finally{await browser.close()}
