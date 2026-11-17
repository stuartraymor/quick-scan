// SPDX-License-Identifier: AGPL-3.0-only
// 2D Sketch overhaul 3.1: an angle dimension in hand follows the cursor's
// sector — the corner's 60°, the supplementary 120°, the reflex 300° — its
// number live; the click puts it down in that sector, and moving the number
// later keeps the value. Typing a new value drives the sector it measures.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {launchApp,loadScan,sleep,shotPath} from '../../../scripts/e2e-lib.mjs';
import {openReverse} from './lib.mjs';
const out=shotPath('angle-sector');fs.mkdirSync(out,{recursive:true});
const mesh=[];for(const z of [-5,5])for(let i=0;i<160;i++){const a=i*Math.PI/80;mesh.push(`v ${10*Math.cos(a)} ${10*Math.sin(a)} ${z}`)}
mesh.push('v 0 0 -5','v 0 0 5');for(let i=0;i<160;i++){const a=i+1,b=(i+1)%160+1;mesh.push(`f ${a} ${b} ${b+160}`,`f ${a} ${b+160} ${a+160}`,`f 321 ${b} ${a}`,`f 322 ${a+160} ${b+160}`)}
const meshPath=out+'/cylinder.obj';fs.writeFileSync(meshPath,mesh.join('\n'));
const {browser,page,consoleErrors}=await launchApp({width:1600,height:1000});
const screen=p=>page.evaluate(p=>window.__re.sheet().sheetScreenPoint(p),p);
const labels=()=>page.$$eval('.sketch-dim',els=>els.map(e=>(e.value??e.textContent??'').trim()).filter(Boolean));
const angleText=async()=>{const all=await labels();return all.find(t=>/°/.test(t))??all.join('|')};
const S3=Math.sqrt(3);
try{
 await loadScan(page,meshPath);await openReverse(page);
 // A corner at (20, 0): line 1 along +X, line 2 at 60°, joined.
 const entities=[{kind:'line',a:[20,0],b:[40,0]},{kind:'line',a:[20,0],b:[30,10*S3]}];
 await page.evaluate(async entities=>{const r=window.__re.store;r.setState({sketchDraft:null});r.getState().startSketch({kind:'world',axis:'z',offset:0},{origin:[0,0,0],normal:[0,0,1],basisU:[1,0,0],basisV:[0,1,0]},entities);},entities);await sleep(900);
 await page.evaluate(()=>window.__re.sheet().zoomTo?.([0,-15,45,20]));await sleep(300);
 await page.evaluate(()=>window.__re.store.getState().setSketchTool('dimension'));await sleep(150);
 for(const p of [[33,0],[25,5*S3]]){const at=await screen(p);await page.mouse.move(at.x,at.y);await sleep(80);await page.mouse.click(at.x,at.y);await sleep(200)}
 const inHand=await page.evaluate(()=>window.__re.store.getState().sketchDraft.dimMade);assert.ok(inHand!=null,'angle in hand');
 const seen={};
 for(const [name,p] of [['minor',[30,4]],['supplementary',[12,6]],['reflex',[14,-6]],['supplementary2',[30,-4]]]){
  const at=await screen(p);await page.mouse.move(at.x,at.y,{steps:4});await sleep(200);
  seen[name]=await angleText();await page.screenshot({path:`${out}/0-${name}.png`});
 }
 console.log('live',JSON.stringify(seen));
 assert.match(seen.minor,/^60(\.0+)?\s*°/);assert.match(seen.supplementary,/^120(\.0+)?\s*°/);assert.match(seen.reflex,/^300(\.0+)?\s*°/);assert.match(seen.supplementary2,/^120(\.0+)?\s*°/);
 // Put it down in the reflex sector.
 const reflexAt=await screen([14,-6]);await page.mouse.move(reflexAt.x,reflexAt.y,{steps:3});await sleep(150);await page.mouse.click(reflexAt.x,reflexAt.y);await sleep(300);
 let c=await page.evaluate(()=>window.__re.store.getState().sketchDraft.sketch.constraints.find(c=>c.kind==='angle'));
 assert.ok(c?.sector&&Math.abs(c.value-300)<1e-9,'put down as reflex 300°: '+JSON.stringify(c));
 await page.keyboard.press('Escape');await sleep(150);
 await page.evaluate(()=>window.__re.store.getState().setSketchTool('select'));
 // Moving its number into the minor sector keeps 300°.
 await page.evaluate(id=>{const s=window.__re.store.getState();s.moveDimension(id,[32,5],true)},c.id);await sleep(200);
 const moved=await page.evaluate(()=>window.__re.store.getState().sketchDraft.sketch.constraints.find(c=>c.kind==='angle'));
 assert.equal(moved.value,c.value,'value kept on reposition');assert.deepEqual(moved.sector,c.sector,'sector kept');
 // Typing 290 drives the reflex sector: line 2 swings to 70° from line 1.
 await page.evaluate(id=>window.__re.store.getState().setDimensionValue(id,290),c.id);await sleep(300);
 const [l1,l2]=await page.evaluate(()=>[1,2].map(id=>window.__re.store.getState().sketchDraft.sketch.entities.find(e=>e.id===id)));
 const dir=l=>Math.atan2(l.b[1]-l.a[1],l.b[0]-l.a[0])*180/Math.PI;
 const ang=((dir(l2)-dir(l1))%360+360)%360;
 assert.ok(Math.abs(ang-70)<1e-4,'line 2 at 70° from line 1: '+ang);
 await page.screenshot({path:out+'/1-typed-290.png'});
 fs.writeFileSync(out+'/result.json',JSON.stringify({passed:true,seen,constraint:c,after:ang},null,2));
 assert.deepEqual(consoleErrors,[]);console.log('PASS angle sector: live',Object.values(seen).join(' / '),'· reflex kept on move · 290° drives line to',ang.toFixed(6));
}catch(e){await page.screenshot({path:out+'/failure.png'});console.log(await page.evaluate(()=>document.body.innerText.slice(-1200)));throw e;}finally{await browser.close()}
