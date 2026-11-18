// SPDX-License-Identifier: AGPL-3.0-only
// 2D Sketch overhaul 7: the spline by mouse. While drawing, right-click
// offers Finish / Close and finish / Remove last point / Restart drawing,
// each enabled only when it can act; a double-click finishes. On a finished
// spline right-click offers Modify, Add point here, Remove this point,
// Rebuild…, Fixed, Construction and Delete. With the spline selected, a
// handle at its end sets the tangent (snapping upright), one undo step, and
// a double-click on it frees the end again.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {launchApp,loadScan,sleep,shotPath} from '../../../scripts/e2e-lib.mjs';
import {openReverse} from './lib.mjs';
const out=shotPath('sketch-spline-edit');fs.mkdirSync(out,{recursive:true});
const mesh=[];for(const z of [-5,5])for(let i=0;i<160;i++){const a=i*Math.PI/80;mesh.push(`v ${10*Math.cos(a)} ${10*Math.sin(a)} ${z}`)}
mesh.push('v 0 0 -5','v 0 0 5');for(let i=0;i<160;i++){const a=i+1,b=(i+1)%160+1;mesh.push(`f ${a} ${b} ${b+160}`,`f ${a} ${b+160} ${a+160}`,`f 321 ${b} ${a}`,`f 322 ${a+160} ${b+160}`)}
const meshPath=out+'/cylinder.obj';fs.writeFileSync(meshPath,mesh.join('\n'));
const {browser,page,consoleErrors}=await launchApp({width:1700,height:1050});
const draft=()=>page.evaluate(()=>{const d=window.__re.store.getState().sketchDraft;return {tool:d.tool,pending:d.pending.length,sketch:d.sketch,history:d.history.length,selection:d.selection}});
const screen=p=>page.evaluate(p=>window.__re.sheet().sheetScreenPoint(p),p);
const splines=async()=>(await draft()).sketch.entities.filter(e=>e.kind==='spline');
const menu=async(p)=>{const s=await screen(p);await page.mouse.move(s.x,s.y);await page.mouse.click(s.x,s.y,{button:'right'});await page.waitForSelector('[data-test=spline-menu]',{timeout:3000});await sleep(100)};
const enabled=()=>page.$$eval('[data-test=spline-menu] [role=menuitem]',es=>Object.fromEntries(es.map(e=>[e.dataset.test.replace('spline-menu-',''),!e.disabled])));
const choose=async t=>{await page.click(`[data-test=spline-menu-${t}]`);await sleep(300)};
const clickAt=async p=>{const s=await screen(p);await page.mouse.click(s.x,s.y);await sleep(120)};
const result={};
try{
 await loadScan(page,meshPath);await openReverse(page);
 await page.evaluate(()=>{const r=window.__re.store;r.setState({sketchDraft:null});r.getState().startSketch({kind:'world',axis:'z',offset:0},{origin:[0,0,0],normal:[0,0,1],basisU:[1,0,0],basisV:[0,1,0]},[{kind:'line',a:[-40,-30],b:[40,-30]}])});await sleep(900);
 await page.evaluate(()=>window.__re.sheet().zoomTo?.([-45,-35,45,35]));await sleep(300);
 await page.$eval('[data-test=sketch-tool-spline]',e=>e.click());await sleep(200);
 for(const p of [[-30,0],[-15,12],[0,0]])await clickAt(p);
 assert.equal((await draft()).pending,3);
 await menu([5,-5]);
 assert.deepEqual(await enabled(),{finish:true,close:true,'remove-last':true,restart:true});
 await page.screenshot({path:out+'/01-drawing-menu.png'});
 await choose('remove-last');assert.equal((await draft()).pending,2,'remove last');
 await menu([5,-5]);assert.deepEqual(await enabled(),{finish:true,close:false,'remove-last':true,restart:true},'close needs 3');
 await choose('restart');assert.equal((await draft()).pending,0,'restart');
 assert.equal((await splines()).length,0);
 // Draw again and finish with a double-click.
 for(const p of [[-30,0],[-15,12],[0,0],[15,-12]])await clickAt(p);
 const last=await screen([30,0]);await page.mouse.click(last.x,last.y,{clickCount:1});await page.mouse.click(last.x,last.y,{clickCount:2});await sleep(300);
 let sp=await splines();assert.equal(sp.length,1,'double-click finishes');assert.equal(sp[0].pts.length,5);
 assert.equal((await draft()).tool,'select');
 const id=sp[0].id;
 // Right-click on the curve between points: Add point here.
 const onCurve=await page.evaluate(async id=>{const m=await import('/plugins/reverse/core/sketchSpline.ts');const e=window.__re.store.getState().sketchDraft.sketch.entities.find(x=>x.id===id);return m.splineAt(m.splineCurve(e),1.5)},id);
 await menu(onCurve);
 const m1=await enabled();result.curveMenu=m1;
 assert.equal(Object.keys(m1).join(','),'modify,add,remove,rebuild,fixed,construction,delete','finished-spline menu lists only implemented items');
 await page.screenshot({path:out+'/02-spline-menu.png'});
 if(m1.add){await choose('add');sp=await splines();assert.equal(sp[0].pts.length,6,'point added')}else{await page.keyboard.press('Escape');throw new Error('Add point not enabled on the curve: '+JSON.stringify(m1))}
 // Right-click on a point: Remove this point.
 const p2=sp[0].pts[2];await menu(p2);assert.ok((await enabled()).remove,'remove enabled on a point');await choose('remove');
 sp=await splines();assert.equal(sp[0].pts.length,5,'point removed');
 // Rebuild through 9.
 await menu(sp[0].pts[1]);await choose('rebuild');await page.waitForSelector('[data-test=spline-rebuild-count]');
 await page.$eval('[data-test=spline-rebuild-count]',e=>e.select());await page.keyboard.type('9');await page.click('[data-test=spline-rebuild-ok]');await sleep(300);
 sp=await splines();assert.equal(sp[0].pts.length,9,'rebuilt through 9');
 result.rebuildMessage=await page.$eval('[data-test=spline-message]',e=>e.textContent).catch(()=>null);
 assert.match(result.rebuildMessage??'',/Rebuilt through 9 points; the curve moved/);
 // Modify: selected, end handles shown. Drag the start handle upright.
 await menu(sp[0].pts[3]);await choose('modify');
 assert.deepEqual((await draft()).selection,[id]);
 const start=sp[0].pts[0];
 // The knob is 46 px from the end along the start tangent: find it by the drawn handle colour is fragile, so compute it.
 const k=await page.evaluate(async([id])=>{const m=await import('/plugins/reverse/core/sketchSpline.ts');const d=window.__re.store.getState().sketchDraft;const e=d.sketch.entities.find(x=>x.id===id);const dir=m.splineDirAt(m.splineCurve(e),0);const at=window.__re.sheet().sheetScreenPoint(e.pts[0]);return {x:at.x+dir[0]*46,y:at.y-dir[1]*46}},[id]);
 const histBefore=(await draft()).history;
 await page.mouse.move(k.x,k.y);await sleep(150);await page.screenshot({path:out+'/03-handle-hover.png'});
 const startScreen=await screen(start);
 await page.mouse.down();await page.mouse.move(startScreen.x+2,startScreen.y-60,{steps:8});await sleep(100);await page.mouse.up();await sleep(300);
 sp=await splines();result.startDir=sp[0].startDir;
 assert.ok(Math.abs(sp[0].startDir-Math.PI/2)<1e-12,'tangent snapped upright: '+sp[0].startDir);
 assert.equal((await draft()).history,histBefore+1,'one undo step');
 await page.screenshot({path:out+'/04-tangent-set.png'});
 // Double-click the handle (now upright): the end runs free.
 const up=await screen(start);const kx=up.x,ky=up.y-46;
 await page.mouse.click(kx,ky);await page.mouse.click(kx,ky);await sleep(300);
 sp=await splines();assert.equal(sp[0].startDir,undefined,'double-click frees the end');
 // Undo twice: back to the upright then to free.
 await page.evaluate(()=>window.__re.store.getState().undoSketch());await sleep(200);
 assert.ok(Math.abs((await splines())[0].startDir-Math.PI/2)<1e-12,'undo restores the tangent');
 // Construction and Delete from the menu.
 await menu((await splines())[0].pts[4]);await choose('construction');
 assert.equal((await splines())[0].construction,true,'construction from the menu');
 await menu((await splines())[0].pts[4]);await page.keyboard.press('Escape');await sleep(150);
 assert.equal(await page.$('[data-test=spline-menu]'),null,'Esc closes the menu');
 await menu((await splines())[0].pts[4]);await choose('delete');
 assert.equal((await splines()).length,0,'deleted from the menu');
 // A right-click on empty sheet with nothing drawing opens no menu.
 const empty=await screen([0,25]);await page.mouse.click(empty.x,empty.y,{button:'right'});await sleep(200);
 assert.equal(await page.$('[data-test=spline-menu]'),null);
 fs.writeFileSync(out+'/result.json',JSON.stringify({passed:true,...result},null,2));
 assert.deepEqual(consoleErrors,[]);console.log('PASS spline edit: drawing menu, double-click finish, add/remove/rebuild, tangent handle upright',result.startDir,', free, construction, delete');
}catch(e){await page.screenshot({path:out+'/failure.png'});console.log(JSON.stringify(result));console.log(await page.evaluate(()=>document.body.innerText.slice(-1200)));throw e;}finally{await browser.close()}
