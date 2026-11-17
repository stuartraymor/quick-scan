// SPDX-License-Identifier: AGPL-3.0-only
// Corner Trim brush (2D Sketch overhaul batch 1): the ring follows the
// cursor, rings the ends it would take, previews the corner while held, and
// a fast two-step sweep across a line end and an arc end still joins them at
// their exact crossing, in one undo step.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {launchApp,loadScan,sleep,shotPath} from '../../../scripts/e2e-lib.mjs';
import {openReverse} from './lib.mjs';
const out=shotPath('corner-brush');fs.mkdirSync(out,{recursive:true});
const mesh=[];for(const z of [-5,5])for(let i=0;i<160;i++){const a=i*Math.PI/80;mesh.push(`v ${10*Math.cos(a)} ${10*Math.sin(a)} ${z}`)}
mesh.push('v 0 0 -5','v 0 0 5');for(let i=0;i<160;i++){const a=i+1,b=(i+1)%160+1;mesh.push(`f ${a} ${b} ${b+160}`,`f ${a} ${b+160} ${a+160}`,`f 321 ${b} ${a}`,`f 322 ${a+160} ${b+160}`)}
const meshPath=out+'/cylinder.obj';fs.writeFileSync(meshPath,mesh.join('\n'));
const {browser,page,consoleErrors}=await launchApp({width:1800,height:1100});
const read=()=>page.evaluate(()=>{const d=window.__re.store.getState().sketchDraft;return {sketch:d.sketch,history:d.history.length}});
const seed=async entities=>{await page.evaluate(async entities=>{const r=window.__re.store;(await import('/plugins/reverse/state/sketchCornerTrimStore.ts')).useSketchCornerTrim.getState().cancel();r.setState({sketchDraft:null});r.getState().startSketch({kind:'world',axis:'z',offset:0},{origin:[0,0,0],normal:[0,0,1],basisU:[1,0,0],basisV:[0,1,0]},entities);},entities);await sleep(600)};
const screen=p=>page.evaluate(p=>window.__re.sheet().sheetScreenPoint(p),p);
const arcEnd=(c,r,a)=>[c[0]+r*Math.cos(a),c[1]+r*Math.sin(a)];
try{
 await loadScan(page,meshPath);await openReverse(page);
 const entities=[{kind:'line',a:[-10,0],b:[2,0]},{kind:'arc',c:[10,3],r:5,start:2,sweep:1}];
 await seed(entities);const before=await read();
 await page.waitForSelector('[data-test=sketch-sharpen]',{timeout:5000});
 await page.screenshot({path:out+'/01-controls-icon.png',clip:{x:0,y:0,width:520,height:1100}});
 await page.$eval('[data-test=sketch-sharpen]',e=>e.click());await sleep(250);
 const lineEnd=await screen([2,0]),arcB=await screen(arcEnd([10,3],5,3));
 // Hover: the ring follows the cursor and rings the line end under it.
 await page.mouse.move(lineEnd.x+2,lineEnd.y+1);await sleep(120);
 const cursor=await page.evaluate(()=>getComputedStyle(document.querySelector('[data-test=sketch-viewport]')).cursor);
 assert.equal(cursor,'none');
 await page.screenshot({path:out+'/02-hover-ring.png'});
 assert.deepEqual((await read()).sketch,before.sketch);
 // Fast sweep: two coarse steps, held preview, unchanged until release.
 await page.mouse.down();await page.mouse.move(arcB.x,arcB.y,{steps:2});await sleep(150);
 assert.deepEqual((await read()).sketch,before.sketch);
 await page.screenshot({path:out+'/03-held-preview.png'});
 await page.mouse.up();await sleep(250);
 const after=await read();
 const line=after.sketch.entities.find(e=>e.id===1),arc=after.sketch.entities.find(e=>e.id===2);
 const end=arcEnd(arc.c,arc.r,arc.start+arc.sweep);
 assert.ok(Math.hypot(line.b[0]-6,line.b[1])<1e-8,'line end at the true crossing');
 assert.ok(Math.hypot(end[0]-6,end[1])<1e-8,'arc end at the true crossing');
 assert.equal(after.history,1);
 await page.screenshot({path:out+'/04-released.png'});
 await page.$eval('[data-test=undo]',e=>e.click());await sleep(150);assert.deepEqual((await read()).sketch,before.sketch);
 // Empty space: a stroke that takes no ends changes nothing.
 const empty=await screen([-5,8]);await page.mouse.move(empty.x,empty.y);await page.mouse.down();await page.mouse.move(empty.x+60,empty.y+10,{steps:4});await page.mouse.up();await sleep(150);
 assert.deepEqual((await read()).sketch,before.sketch);
 // Esc while held cancels with nothing changed.
 await page.mouse.move(lineEnd.x,lineEnd.y);await page.mouse.down();await page.mouse.move(arcB.x,arcB.y,{steps:3});await page.keyboard.press('Escape');await page.mouse.up();await sleep(150);
 assert.deepEqual((await read()).sketch,before.sketch);
 fs.writeFileSync(out+'/result.json',JSON.stringify({passed:true,line,arc},null,2));
 assert.deepEqual(consoleErrors,[]);console.log('PASS corner brush: hover ring, held preview, fast sweep line/arc join, undo, empty stroke, Esc');
}catch(e){await page.screenshot({path:out+'/failure.png'});console.log(await page.evaluate(()=>document.body.innerText.slice(-2500)));throw e;}finally{await browser.close()}
