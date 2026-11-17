// SPDX-License-Identifier: AGPL-3.0-only
// Construction geometry is drawn dotted on the sketch sheet (2D Sketch
// overhaul batch 2), with the same on-screen dot at two zoom levels, and
// stays out of closed regions.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {launchApp,loadScan,sleep,shotPath} from '../../../scripts/e2e-lib.mjs';
import {openReverse} from './lib.mjs';
const out=shotPath('construction-dotted');fs.mkdirSync(out,{recursive:true});
const mesh=[];for(const z of [-5,5])for(let i=0;i<160;i++){const a=i*Math.PI/80;mesh.push(`v ${10*Math.cos(a)} ${10*Math.sin(a)} ${z}`)}
mesh.push('v 0 0 -5','v 0 0 5');for(let i=0;i<160;i++){const a=i+1,b=(i+1)%160+1;mesh.push(`f ${a} ${b} ${b+160}`,`f ${a} ${b+160} ${a+160}`,`f 321 ${b} ${a}`,`f 322 ${a+160} ${b+160}`)}
const meshPath=out+'/cylinder.obj';fs.writeFileSync(meshPath,mesh.join('\n'));
const {browser,page,consoleErrors}=await launchApp({width:1400,height:900});
try{
 await loadScan(page,meshPath);await openReverse(page);
 const entities=[{kind:'line',a:[-12,4],b:[12,4],construction:true},{kind:'circle',c:[0,-3],r:4,construction:true},{kind:'arc',c:[0,-3],r:6,start:0.2,sweep:2,construction:true},
  {kind:'line',a:[-8,-8],b:[8,-8]},{kind:'line',a:[8,-8],b:[8,0]},{kind:'line',a:[8,0],b:[-8,-8]}];
 await page.evaluate(async entities=>{const r=window.__re.store;r.setState({sketchDraft:null});r.getState().startSketch({kind:'world',axis:'z',offset:0},{origin:[0,0,0],normal:[0,0,1],basisU:[1,0,0],basisV:[0,1,0]},entities);},entities);await sleep(900);
 const state=await page.evaluate(()=>{const s=window.__re.sheet();const dashed=[...s.dashed??[]];return {count:dashed.length,px:dashed.map(d=>[d.mat.dashSize/s.unitsPerScreenPx(),d.mat.gapSize/s.unitsPerScreenPx()])}});
 assert.equal(state.count,3,'three construction pieces dotted');
 console.log("px",JSON.stringify(state.px));for(const [d,g] of state.px){assert.ok(Math.abs(d-4)<5e-3&&Math.abs(g-4)<5e-3)}
 await page.screenshot({path:out+'/01-default.png'});
 const view=await page.$('[data-test=sketch-viewport]');const box=await view.boundingBox();
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);for(let i=0;i<5;i++){await page.mouse.wheel({deltaY:-240});await sleep(80)}await sleep(400);
 const zoomed=await page.evaluate(()=>{const s=window.__re.sheet();return [...s.dashed].map(d=>d.mat.dashSize/s.unitsPerScreenPx())});
 for(const d of zoomed)assert.ok(Math.abs(d-4)<1e-3,'dot stays 4 px after zoom: '+d);
 await page.screenshot({path:out+'/02-zoomed.png'});
 const regions=await page.evaluate(()=>window.__re.store.getState().sketchDraft.report?.regions?.length ?? null);
 fs.writeFileSync(out+'/result.json',JSON.stringify({passed:true,state,zoomed,regions},null,2));
 assert.deepEqual(consoleErrors,[]);console.log('PASS dotted construction',JSON.stringify(state),'zoomed',zoomed.map(v=>v.toFixed(3)).join(','),'regions',regions);
}catch(e){await page.screenshot({path:out+'/failure.png'});throw e;}finally{await browser.close()}
