// SPDX-License-Identifier: AGPL-3.0-only
// 2D Sketch overhaul 5: Duplicate / Pattern panel, driven by real clicks.
// Linear: a rectangle far from the origin, two directions, an arrow tip
// dragged and the field following, spacing typed in inches (1 in = 25.4 mm)
// with no geometry moved by the unit switch, Accept as one undo step at
// exact coordinates. Circular: centre picked on a circle, 6 over 360° with
// no copy on the original. Angular: a line turned in place. Along curve:
// guide picked on the sheet, equal arc-length spacing on an arc. Esc backs
// out of a pick, then the pattern, changing nothing.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {launchApp,loadScan,sleep,shotPath} from '../../../scripts/e2e-lib.mjs';
import {openReverse} from './lib.mjs';
const out=shotPath('sketch-pattern');fs.mkdirSync(out,{recursive:true});
const mesh=[];for(const z of [-5,5])for(let i=0;i<160;i++){const a=i*Math.PI/80;mesh.push(`v ${10*Math.cos(a)} ${10*Math.sin(a)} ${z}`)}
mesh.push('v 0 0 -5','v 0 0 5');for(let i=0;i<160;i++){const a=i+1,b=(i+1)%160+1;mesh.push(`f ${a} ${b} ${b+160}`,`f ${a} ${b+160} ${a+160}`,`f 321 ${b} ${a}`,`f 322 ${a+160} ${b+160}`)}
const meshPath=out+'/cylinder.obj';fs.writeFileSync(meshPath,mesh.join('\n'));
const {browser,page,consoleErrors}=await launchApp({width:1700,height:1050});
const read=()=>page.evaluate(()=>{const d=window.__re.store.getState().sketchDraft;return {sketch:d.sketch,history:d.history.length,selection:d.selection}});
const screen=p=>page.evaluate(p=>window.__re.sheet().sheetScreenPoint(p),p);
const near=(p,q,t=1e-9)=>Math.hypot(p[0]-q[0],p[1]-q[1])<t;
const text=sel=>page.$eval(sel,e=>e.textContent);
const value=sel=>page.$eval(sel,e=>e.value);
const select=ids=>page.evaluate(ids=>window.__re.store.setState(s=>({sketchDraft:{...s.sketchDraft,selection:ids}})),ids);
const type=async(test,v)=>{const el=await page.$(`[data-test=${test}]`);await el.focus();await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');await page.keyboard.type(String(v));await sleep(200)};
const click=async test=>{await page.$eval(`[data-test=${test}]`,e=>e.click());await sleep(200)};
const accepted=async()=>Number((await text('[data-test=pattern-accept]')).match(/\((\d+)\)/)?.[1]??0);
const result={};
try{
 await loadScan(page,meshPath);await openReverse(page);
 const entities=[
  {kind:'line',a:[60,40],b:[64,40]},{kind:'line',a:[64,40],b:[64,43]},{kind:'line',a:[64,43],b:[60,43]},{kind:'line',a:[60,43],b:[60,40]},
  {kind:'circle',c:[50,0],r:3},{kind:'point',p:[60,0]},
  {kind:'line',a:[-40,20],b:[-30,20]},
  {kind:'arc',c:[0,-40],r:20,start:0,sweep:Math.PI},{kind:'point',p:[20,-40]},
 ];
 await page.evaluate(async entities=>{const r=window.__re.store;r.setState({sketchDraft:null});r.getState().startSketch({kind:'world',axis:'z',offset:0},{origin:[0,0,0],normal:[0,0,1],basisU:[1,0,0],basisV:[0,1,0]},entities);},entities);await sleep(900);
 await page.evaluate(()=>window.__re.sheet().zoomTo?.([-60,-70,110,70]));await sleep(300);
 const before=await read();const ids=before.sketch.entities.map(e=>e.id);
 const rect=ids.slice(0,4),hub=ids[4],dot=ids[5],bar=ids[6],guide=ids[7],seed=ids[8];
 // ---- Linear, opened from Duplicate.
 await select(rect);await click('sketch-duplicate');await click('sketch-duplicate-pattern');
 assert.ok(await page.$('[data-test=sketch-pattern-panel]'),'pattern panel open from Duplicate');
 assert.match(await text('[data-test=pattern-pieces]'),/4 pieces selected · instances include the original/);
 await type('pattern-d1-count',3);await type('pattern-d1-spacing',10);
 assert.equal(await accepted(),8,'3 instances along X: 2 copies of 4 pieces');
 await click('pattern-d2-on');
 assert.equal(await accepted(),20,'3 × 2 grid: 5 copies');
 assert.equal((await read()).sketch.entities.length,before.sketch.entities.length,'preview only');
 await page.screenshot({path:out+'/01-linear-grid.png'});
 // Drag the Direction 1 arrow tip to about 15 mm: the field follows.
 const tip=await screen([62+10,41.5]),to=await screen([62+15,41.5]);
 await page.mouse.move(tip.x,tip.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:6});await page.mouse.up();await sleep(250);
 const dragged=Number(await value('[data-test=pattern-d1-spacing]'));result.dragged=dragged;
 assert.ok(Math.abs(dragged-15)<0.5,'arrow drag sets the spacing: '+dragged);
 // Inches: the field converts, nothing moves; typing 1 in gives 25.4 mm.
 const geom=JSON.stringify((await read()).sketch.entities);
 await page.click('[data-test="ribbon-tab-settings"]');await sleep(150);await page.click('[data-test="ribbon-inches"]');await sleep(400);
 result.inchField=await value('[data-test=pattern-d1-spacing]');
 assert.ok(Math.abs(Number(result.inchField)-dragged/25.4)<1e-5,'spacing shown in inches: '+result.inchField);
 assert.equal(JSON.stringify((await read()).sketch.entities),geom,'unit switch moves nothing');
 await type('pattern-d1-spacing',1);await type('pattern-d2-spacing',0.5);
 await page.click('[data-test="ribbon-tab-settings"]');await sleep(150);await page.click('[data-test="ribbon-millimetres"]');await sleep(300);
 result.mmField=await value('[data-test=pattern-d1-spacing]');
 assert.equal(Number(result.mmField),25.4,'1 in = 25.4 mm');
 await click('pattern-accept');
 const lin=await read();
 assert.equal(lin.sketch.entities.length,before.sketch.entities.length+20);assert.equal(lin.history,before.history+1,'one undo step');
 const corner=lin.sketch.entities.filter(e=>e.kind==='line'&&!rect.includes(e.id)).map(e=>e.a);
 for(const [i,j] of [[1,0],[2,0],[0,1],[1,1],[2,1]])assert.ok(corner.some(p=>near(p,[60+25.4*i,40+12.7*j])),`grid corner ${i},${j}`);
 assert.equal(await page.$('[data-test=sketch-pattern-panel]'),null,'panel closes on Accept');
 await page.screenshot({path:out+'/02-linear-accepted.png'});
 await page.evaluate(()=>window.__re.store.getState().undoSketch());await sleep(250);
 assert.equal((await read()).sketch.entities.length,before.sketch.entities.length,'undo removes the grid');
 // ---- Circular about a picked circle's centre.
 await select([dot]);await click('sketch-pattern');await click('pattern-mode-circular');
 await click('pattern-centre-pick');
 const onHub=await screen([50,3]);await page.mouse.move(onHub.x,onHub.y);await sleep(150);await page.mouse.click(onHub.x,onHub.y);await sleep(250);
 assert.match(await text('[data-test=pattern-centre]'),new RegExp('Centre of '+hub));
 assert.equal(await accepted(),5,'6 over 360°: 5 copies');
 assert.equal(Number(await value('[data-test=pattern-increment]')),60);
 await page.screenshot({path:out+'/03-circular.png'});
 await page.keyboard.press('Enter');await sleep(300);
 const circ=(await read()).sketch.entities.filter(e=>e.kind==='point'&&e.id!==dot&&e.id!==seed);
 assert.equal(circ.length,5);
 for(let k=1;k<6;k++)assert.ok(circ.some(e=>near(e.p,[50+10*Math.cos(k*Math.PI/3),10*Math.sin(k*Math.PI/3)])),'circular copy '+k);
 assert.ok(!circ.some(e=>near(e.p,[60,0],1e-6)),'no copy on the original');
 await page.evaluate(()=>window.__re.store.getState().undoSketch());await sleep(200);
 // ---- Angular: the bar turned in place by 90°.
 await select([bar]);await click('sketch-pattern');await click('pattern-mode-angular');
 await type('pattern-count',2);await type('pattern-step',90);
 assert.match(await text('[data-test=pattern-pivot]'),/Selection centre/);
 await click('pattern-accept');
 const ang=(await read()).sketch.entities.find(e=>e.kind==='line'&&e.id>Math.max(...ids));
 assert.ok(near(ang.a,[-35,15],1e-9)&&near(ang.b,[-35,25],1e-9),'turned in place '+JSON.stringify(ang));
 await page.evaluate(()=>window.__re.store.getState().undoSketch());await sleep(200);
 // ---- Along curve: pick the arc, 5 equal by arc length.
 await select([seed]);await click('sketch-pattern');await click('pattern-mode-alongCurve');
 assert.match(await text('[data-test=pattern-message]'),/guide curve/);
 const onArc=await screen([20*Math.cos(1),-40+20*Math.sin(1)]);await page.mouse.move(onArc.x,onArc.y);await sleep(150);
 await page.screenshot({path:out+'/04-guide-hover.png'});
 await page.mouse.click(onArc.x,onArc.y);await sleep(250);
 assert.match(await text('[data-test=pattern-curve]'),new RegExp('arc '+guide+', length 62\\.832'));
 await type('pattern-count',5);
 assert.equal(await accepted(),4);
 await page.screenshot({path:out+'/05-along-curve.png'});
 await click('pattern-accept');
 const along=(await read()).sketch.entities.filter(e=>e.kind==='point'&&e.id>Math.max(...ids));
 for(let k=1;k<5;k++)assert.ok(along.some(e=>near(e.p,[20*Math.cos(k*Math.PI/4),-40+20*Math.sin(k*Math.PI/4)],1e-7)),'equal arc length '+k);
 // ---- Esc: out of a pick, then out of the pattern, nothing changed.
 const n=(await read()).sketch.entities.length;
 await select([seed]);await click('sketch-pattern');await click('pattern-mode-circular');await click('pattern-centre-pick');
 await page.keyboard.press('Escape');await sleep(150);
 assert.ok(await page.$('[data-test=sketch-pattern-panel]'),'first Esc ends the pick only');
 await page.keyboard.press('Escape');await sleep(150);
 assert.equal(await page.$('[data-test=sketch-pattern-panel]'),null);assert.equal((await read()).sketch.entities.length,n);
 fs.writeFileSync(out+'/result.json',JSON.stringify({passed:true,...result},null,2));
 assert.deepEqual(consoleErrors,[]);console.log('PASS sketch pattern: linear grid (drag',dragged,'mm, inches',result.inchField,'→ 25.4 mm), circular about a picked centre, angular in place, along an arc by arc length, Esc');
}catch(e){await page.screenshot({path:out+'/failure.png'});console.log(await page.evaluate(()=>document.body.innerText.slice(-1500)));throw e;}finally{await browser.close()}
