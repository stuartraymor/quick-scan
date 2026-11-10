// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
import {launchApp,loadScan,sleep,OUT_DIR} from './e2e-lib.mjs';
import path from 'node:path';
const out=OUT_DIR+path.sep,tag='candidate';
function fixture(kind) {
 const lines=[],n=120,nz=20,r0=kind==='cone'?5:10,r1=10;
 for(let j=0;j<=nz;j++)for(let i=0;i<n;i++){const a=i*2*Math.PI/n,r=r0+(r1-r0)*j/nz;lines.push(`v ${r*Math.cos(a)} ${r*Math.sin(a)} ${-10+j}`)}
 for(let j=0;j<nz;j++)for(let i=0;i<n;i++){const a=j*n+i+1,b=j*n+(i+1)%n+1,c=b+n,d=a+n;lines.push(`f ${a} ${b} ${c}`,`f ${a} ${c} ${d}`)}
 for(const j of [0,nz]){const k=(nz+1)*n+1+(j===0?0:1);lines.push(`v 0 0 ${j===0?-10:10}`);for(let i=0;i<n;i++){const a=j*n+i+1,b=j*n+(i+1)%n+1;lines.push(j===0?`f ${k} ${b} ${a}`:`f ${k} ${a} ${b}`)}}
 const file=out+kind+'.obj';fs.writeFileSync(file,lines.join('\n'));return file;
}
for(const kind of ['plane','cylinder','cone']) {
const {browser,page,consoleErrors}=await launchApp({width:1600,height:1000});
try{
 await loadScan(page,fixture(kind));
 await page.click('[data-test=ribbon-extract-primitives]');
 await page.evaluate(async()=>{const {useMark}=await import('/src/state/markStore.ts');useMark.getState().setWandConnected(false);useMark.getState().setWandDegrees(10)});
 const point=await page.evaluate(kind=>{const sc=window.__scanruler.scene(),mesh=sc.marking.ctx.mesh(),cam=sc.viewLink().camera;const p=mesh.position.clone();if(kind==='plane')p.set(0,0,10);else{const q=cam.position.clone().sub(mesh.position);q.z=0;q.normalize().multiplyScalar(kind==='cone'?7.5:10);p.copy(q)}mesh.localToWorld(p);p.project(cam);const r=document.querySelector('.viewport canvas').getBoundingClientRect();return{x:r.x+(p.x+1)*r.width/2,y:r.y+(1-p.y)*r.height/2}},kind);
 await page.mouse.click(point.x,point.y);await sleep(300);await page.click(`[data-test=extract-type-${kind}]`);await page.waitForSelector('[data-test=extract-preview]');await sleep(400);
 await page.screenshot({path:out+tag+'-'+kind+'-preview.png'});
 await page.click('[data-test=extract-create-stay]');await sleep(600);
 const state=()=>page.evaluate(async()=>{const {useStore}=await import('/src/state/store.ts'),{useMark}=await import('/src/state/markStore.ts'),{drawnFit}=await import('/src/core/elements/assumed.ts');const s=useStore.getState(),el=s.elements[0],sc=window.__scanruler.scene(),g=sc.marking.ctx.mesh().geometry;return{fit:el?.fit,extend:el?.extend,drawn:el?.fit?drawnFit(el.fit,el.assumed,el.extend):null,count:s.elements.length,selected:useMark.getState().count,tinted:[...g.getAttribute('tint').array].some(x=>x!==0),painted:[...g.getAttribute('paint').array].some(x=>x!==0),dark:document.documentElement.dataset.theme==='dark'}});
 let s=await state();assert.equal(s.count,1);assert.equal(s.selected,0);assert.equal(s.painted,false);assert.equal(s.tinted,false);assert.ok(s.dark);
 const expected=kind==='plane'?15.5:kind==='cylinder'?42:31;const actual=kind==='plane'?s.drawn.extentU:s.drawn.length;assert.ok(Math.abs(actual-expected)<0.02,`${actual} vs ${expected}`);
 await page.screenshot({path:out+tag+'-'+kind+'-created.png'});
 await page.click('[data-test=extract-close]');await page.evaluate(async()=>{const h=await import('/src/state/historyStore.ts');h.undo()});await sleep(300);assert.equal((await state()).count,0);
 await page.evaluate(async()=>{const h=await import('/src/state/historyStore.ts');h.redo()});await sleep(700);assert.deepEqual((await state()).extend,s.extend);
 await page.evaluate(()=>{const old=URL.createObjectURL;URL.createObjectURL=b=>{window.__saved=b;return old(b)};HTMLAnchorElement.prototype.click=function(){}});
 await page.waitForFunction(()=>!document.querySelector('[data-test=save-project]')?.disabled);await page.click('[data-test=save-project]');await page.waitForFunction(()=>window.__saved instanceof Blob);
 const bytes=await page.evaluate(async()=>[...new Uint8Array(await window.__saved.arrayBuffer())]);fs.writeFileSync(out+tag+'-'+kind+'.scanruler',Buffer.from(bytes));
 await page.reload({waitUntil:'networkidle0'});await (await page.$('[data-test=project-input]')).uploadFile(out+tag+'-'+kind+'.scanruler');await sleep(1800);const reopened=await state();assert.deepEqual(reopened.extend,s.extend);assert.equal(reopened.tinted,false);assert.equal(reopened.selected,0);
 fs.writeFileSync(out+tag+'-'+kind+'.json',JSON.stringify({created:s,reopened,undoRedo:true,saveReopen:true},null,2));assert.equal(consoleErrors.length,0,consoleErrors.join('\n'));console.log('PASS',kind,'extent',actual,'clear scan, zero selection, undo/redo, save/reopen');
}finally{await browser.close()}

}
