// SPDX-License-Identifier: AGPL-3.0-only
// 2D Sketch overhaul 2.2: Mirror at any distance. A closed rectangle far
// from the sheet's Y axis plus a circle are selected; Mirror opens its panel;
// hovering the Y axis previews the copies; a click picks it, Accept adds
// them (one undo step), the originals untouched and nothing joined. Then the
// quick path (a construction line in the selection) and an angled line.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {launchApp,loadScan,sleep,shotPath} from '../../../scripts/e2e-lib.mjs';
import {openReverse} from './lib.mjs';
const out=shotPath('mirror-axis');fs.mkdirSync(out,{recursive:true});
const mesh=[];for(const z of [-5,5])for(let i=0;i<160;i++){const a=i*Math.PI/80;mesh.push(`v ${10*Math.cos(a)} ${10*Math.sin(a)} ${z}`)}
mesh.push('v 0 0 -5','v 0 0 5');for(let i=0;i<160;i++){const a=i+1,b=(i+1)%160+1;mesh.push(`f ${a} ${b} ${b+160}`,`f ${a} ${b+160} ${a+160}`,`f 321 ${b} ${a}`,`f 322 ${a+160} ${b+160}`)}
const meshPath=out+'/cylinder.obj';fs.writeFileSync(meshPath,mesh.join('\n'));
const {browser,page,consoleErrors}=await launchApp({width:1600,height:1000});
const read=()=>page.evaluate(()=>{const d=window.__re.store.getState().sketchDraft;return {sketch:d.sketch,history:d.history.length,selection:d.selection}});
const screen=p=>page.evaluate(p=>window.__re.sheet().sheetScreenPoint(p),p);
const near=(p,q,t=1e-9)=>Math.hypot(p[0]-q[0],p[1]-q[1])<t;
try{
 await loadScan(page,meshPath);await openReverse(page);
 const entities=[{kind:'line',a:[20,5],b:[30,5]},{kind:'line',a:[30,5],b:[30,12]},{kind:'line',a:[30,12],b:[20,12]},{kind:'line',a:[20,12],b:[20,5]},{kind:'circle',c:[25,-6],r:2},
  {kind:'line',a:[-5,-20],b:[15,0]}];
 await page.evaluate(async entities=>{const r=window.__re.store;r.setState({sketchDraft:null});r.getState().startSketch({kind:'world',axis:'z',offset:0},{origin:[0,0,0],normal:[0,0,1],basisU:[1,0,0],basisV:[0,1,0]},entities);},entities);await sleep(900);
 await page.evaluate(()=>window.__re.sheet().zoomTo?.([-40,-25,40,20]));await sleep(300);
 const before=await read();
 const pieces=before.sketch.entities.slice(0,5).map(e=>e.id);
 await page.evaluate(ids=>window.__re.store.setState(s=>({sketchDraft:{...s.sketchDraft,selection:ids}})),pieces);await sleep(150);
 await page.$eval('[data-test=sketch-mirror]',e=>e.click());await sleep(250);
 assert.ok(await page.$('[data-test=sketch-mirror-panel]'),'mirror panel open');
 assert.match(await page.$eval('[data-test=mirror-axis]',e=>e.textContent),/not picked/);
 assert.equal((await read()).sketch.entities.length,before.sketch.entities.length,'nothing added before a pick');
 // Hover the sheet's Y axis away from all pieces: the preview shows.
 const yAxis=await screen([0,15]);await page.mouse.move(yAxis.x+40,yAxis.y);await sleep(100);await page.mouse.move(yAxis.x+2,yAxis.y);await sleep(250);
 await page.screenshot({path:out+'/01-hover-axis.png'});
 await page.mouse.click(yAxis.x+2,yAxis.y);await sleep(250);
 assert.match(await page.$eval('[data-test=mirror-axis]',e=>e.textContent),/Sketch Y axis/);
 assert.match(await page.$eval('[data-test=mirror-accept]',e=>e.textContent),/Accept \(5\)/);
 await page.screenshot({path:out+'/02-picked.png'});
 const unchanged=await read();assert.equal(unchanged.sketch.entities.length,before.sketch.entities.length,'preview only until Accept');
 await page.$eval('[data-test=mirror-accept]',e=>e.click());await sleep(300);
 const after=await read();
 assert.equal(after.sketch.entities.length,before.sketch.entities.length+5);
 assert.equal(after.history,before.history+1,'one undo step');
 for(const e of before.sketch.entities)assert.deepEqual(after.sketch.entities.find(x=>x.id===e.id),e,'original kept '+e.id);
 const copies=after.sketch.entities.filter(e=>!before.sketch.entities.some(x=>x.id===e.id));
 const lines=copies.filter(e=>e.kind==='line'),circle=copies.find(e=>e.kind==='circle');
 for(const [a,b] of [[[-20,5],[-30,5]],[[-30,5],[-30,12]],[[-30,12],[-20,12]],[[-20,12],[-20,5]]])assert.ok(lines.some(l=>near(l.a,a)&&near(l.b,b)),'mirrored edge '+a+'→'+b);
 assert.ok(near(circle.c,[-25,-6])&&circle.r===2,'mirrored circle');
 const regions=after.sketch&&await page.evaluate(()=>window.__re.store.getState().sketchDraft.report?.regions?.length??null);
 assert.equal(await page.$('[data-test=sketch-mirror-panel]'),null,'panel closed');
 await page.screenshot({path:out+'/03-accepted.png'});
 // Undo removes the copies in one step.
 await page.evaluate(()=>window.__re.store.getState().undoSketch());await sleep(250);
 assert.equal((await read()).sketch.entities.length,before.sketch.entities.length,'undo');
 // Angled line, picked: the circle at (25,-6) about the line y = x - 15 lands at (9, 10).
 await page.evaluate(ids=>window.__re.store.setState(s=>({sketchDraft:{...s.sketchDraft,selection:ids}})),[pieces[4]]);
 await page.$eval('[data-test=sketch-mirror]',e=>e.click());await sleep(200);
 const onLine=await screen([5,-10]);await page.mouse.move(onLine.x,onLine.y);await sleep(150);await page.mouse.click(onLine.x,onLine.y);await sleep(200);
 assert.match(await page.$eval('[data-test=mirror-axis]',e=>e.textContent),/Line/);
 await page.keyboard.press('Enter');await sleep(300);
 const angled=(await read()).sketch.entities.filter(e=>e.kind==='circle').find(e=>!near(e.c,[25,-6]));
 assert.ok(angled&&near(angled.c,[9,10],1e-9),'angled mirror '+JSON.stringify(angled?.c));
 // Esc cancels with nothing changed.
 const n=(await read()).sketch.entities.length;
 await page.$eval('[data-test=sketch-mirror]',e=>e.click());await sleep(200);await page.keyboard.press('Escape');await sleep(200);
 assert.equal(await page.$('[data-test=sketch-mirror-panel]'),null);assert.equal((await read()).sketch.entities.length,n);
 fs.writeFileSync(out+'/result.json',JSON.stringify({passed:true,copies,angled,regions},null,2));
 assert.deepEqual(consoleErrors,[]);console.log('PASS mirror axis: 5 copies about Sketch Y axis, angled circle',angled.c.map(v=>v.toFixed(9)).join(','),'regions',regions);
}catch(e){await page.screenshot({path:out+'/failure.png'});console.log(await page.evaluate(()=>document.body.innerText.slice(-1500)));throw e;}finally{await browser.close()}
