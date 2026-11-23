// SPDX-License-Identifier: AGPL-3.0-only
// Corner Trim swept area and Auto Fillet read from the scan, through the UI.
// A 40 × 30 plate: bottom-right corner R5 round, top-right corner a quarter
// ellipse (3 × 9), bottom-left sharp. Lines sit on the straight edges, short
// of every corner. Each corner is swept press → up → across (the area fanned
// from the press point is the selection), and the result is checked
// geometrically. Auto Fillet follows QUICKSURFACE 8.0.128
// (analysis/corner-sweep-2026-11-19): a sweep that leaves the corner point
// out intersects the lines; one over the corner point fits the least-squares
// tangent arc to the section points on it, also on the ellipse (native
// R 4.565252 on plate-dense); a fillet between separate lines is two undo
// steps, the join and then the fillet.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {launchApp,loadScan,sleep,shotPath} from '../../../scripts/e2e-lib.mjs';
import {openReverse} from './lib.mjs';
const out=shotPath('corner-sweep');fs.mkdirSync(out,{recursive:true});
const R=5,W=20,H=15,outline=[];
// Bottom-right R5, top-right ellipse (3 along x, 9 along y), others sharp.
for(let i=0;i<=24;i++){const a=-Math.PI/2+(Math.PI/2)*i/24;outline.push([W-R+R*Math.cos(a),-H+R+R*Math.sin(a)])}
for(let i=0;i<=32;i++){const a=(Math.PI/2)*i/32;outline.push([W-3+3*Math.cos(a),H-9+9*Math.sin(a)])}
outline.push([-W,H],[-W,-H]);
const n=outline.length,mesh=[];
for(const z of [-5,5])for(const [x,y] of outline)mesh.push(`v ${x} ${y} ${z}`);
mesh.push('v 0 0 -5','v 0 0 5');
for(let i=0;i<n;i++){const a=i+1,b=(i+1)%n+1;mesh.push(`f ${a} ${b} ${b+n}`,`f ${a} ${b+n} ${a+n}`,`f ${2*n+1} ${b} ${a}`,`f ${2*n+2} ${a+n} ${b+n}`)}
const meshPath=out+'/plate.obj';fs.writeFileSync(meshPath,mesh.join('\n'));
const {browser,page,consoleErrors}=await launchApp({width:1800,height:1100});
const read=()=>page.evaluate(()=>{const d=window.__re.store.getState().sketchDraft;return {sketch:d.sketch,history:d.history.length}});
const screen=p=>page.evaluate(p=>window.__re.sheet().sheetScreenPoint(p),p);
const overlayPixels=()=>page.$eval('[data-test="sketch-corner-trim-overlay"]',el=>{const p=el.getContext('2d').getImageData(0,0,el.width,el.height).data;let n=0;for(let i=0;i<p.length;i+=4)if(p[i]===113&&p[i+1]===131&&p[i+2]===139&&p[i+3]>200)n++;return n});
const sweep=async(path,{hold}={})=>{const pts=[];for(const p of path)pts.push(await screen(p));await page.mouse.move(pts[0].x,pts[0].y);await page.mouse.down();for(const p of pts.slice(1))await page.mouse.move(p.x,p.y,{steps:8});await sleep(150);const held=hold?await hold():null;await page.mouse.up();await sleep(400);return held};
const results={};
try{
 await loadScan(page,meshPath);await openReverse(page);
 const entities=[
  {kind:'line',a:[-10,-H],b:[12,-H]},       // 1 bottom
  {kind:'line',a:[W,-7],b:[W,2]},            // 2 right, short of both rounds
  {kind:'line',a:[10,H],b:[-12,H]},          // 3 top
  {kind:'line',a:[-W,10],b:[-W,-10]},        // 4 left
 ];
 await page.evaluate(async entities=>{const r=window.__re.store;r.setState({sketchDraft:null});r.getState().startSketch({kind:'world',axis:'z',offset:0},{origin:[0,0,0],normal:[0,0,1],basisU:[1,0,0],basisV:[0,1,0]},entities);},entities);await sleep(900);
 await page.evaluate(()=>window.__re.sheet().zoomTo?.([-24,-19,24,19]));await sleep(300);
 await page.$eval('[data-test=sketch-sharpen]',e=>e.click());await sleep(200);
 // 1. Corner Trim: press below-left of the bottom-left corner, up, across.
 //    The held area must be filled (many grey pixels), not an L of stroke.
 const before=await read();
 const held=await sweep([[-22,-17],[-22,-8],[-8,-8],[-8,-17]],{hold:async()=>({pixels:await overlayPixels(),sketch:(await read()).sketch})});
 assert.deepEqual(held.sketch,before.sketch,'held sweep changes nothing');
 assert.ok(held.pixels>2000,`filled area rendered (${held.pixels} px)`);
 await page.screenshot({path:out+'/01-trim-released.png'});
 let s=(await read()).sketch;const l1=s.entities.find(e=>e.id===1),l4=s.entities.find(e=>e.id===4);
 assert.ok(Math.hypot(l1.a[0]+W,l1.a[1]+H)<1e-7&&Math.hypot(l4.b[0]+W,l4.b[1]+H)<1e-7,'sharp corner joined at (-20,-15)');
 results.trim={l1,l4,heldPixels:held.pixels};
 // 2. Triangle selection: up then across takes the triangle, so the area
 //    reaches the right line though the cursor track never touches it.
 await page.$eval('[data-test=corner-mode-autoFillet]',e=>e.click());await page.$eval('[data-test=corner-add-dimension]',e=>{if(!e.checked)e.click()});await sleep(150);
 await sweep([[11,-16.5],[11,-12],[21.5,-6]],{hold:async()=>{await page.screenshot({path:out+'/02-autofillet-ends-held.png'});return null}});
 // The thin triangle covers both line ends but leaves the round unpainted:
 // QUICKSURFACE intersects the lines (native-15/16), and so does Quick Scan.
 s=(await read()).sketch;assert.ok(!s.entities.some(e=>e.kind==='arc'),'no fillet from a sweep over the ends alone');
 {const a=s.entities.find(e=>e.id===1),b=s.entities.find(e=>e.id===2);assert.ok(Math.hypot(a.b[0]-W,a.b[1]+H)<1e-7&&Math.hypot(b.a[0]-W,b.a[1]+H)<1e-7,'ends intersected at (20,-15)')}
 assert.match(await page.$eval('[data-test=corner-message]',e=>e.textContent),/Paint over the corner point/);
 results.ends=await page.$eval('[data-test=corner-last-fit]',e=>e.textContent);
 await page.screenshot({path:out+'/02b-autofillet-ends-joined.png'});
 // Sweeping the joined corner and its round fits the round (native-17/18):
 // one undo step, the lines being joined already.
 const histJoined=(await read()).history;
 await sweep([[11,-16.5],[11,-5],[21.5,-5],[21.5,-16.5]],{hold:async()=>{await page.screenshot({path:out+'/02c-autofillet-round-held.png'});return null}});
 const msg=await page.$eval('[data-test=corner-message]',e=>e.textContent).catch(()=>null);
 s=(await read()).sketch;const arc=s.entities.find(e=>e.kind==='arc');assert.ok(arc,'round reconstructed: '+msg);
 assert.ok(Math.abs(arc.r-R)<0.01,`radius ${arc.r}`);assert.ok(Math.hypot(arc.c[0]-(W-R),arc.c[1]-(-H+R))<0.02,`centre ${arc.c}`);
 const b1=s.entities.find(e=>e.id===1),b2=s.entities.find(e=>e.id===2);
 const ends=[0,1].map(k=>{const t=arc.start+k*arc.sweep;return [arc.c[0]+arc.r*Math.cos(t),arc.c[1]+arc.r*Math.sin(t)]});
 const gap=p=>Math.min(...ends.map(e=>Math.hypot(e[0]-p[0],e[1]-p[1])));
 assert.ok(gap(b1.b)<1e-7&&gap(b2.a)<1e-7,'tangent points joined without gaps');
 const fitText=await page.$eval('[data-test=corner-last-fit]',e=>e.textContent);assert.match(fitText,/Fillet R 5\.0\d* mm/);
 assert.equal((await read()).history,histJoined+1,'fillet of joined lines: one undo step');
 results.round={arc,fitText};await page.screenshot({path:out+'/03-round.png'});
 // 3. The quarter ellipse is not circular: QUICKSURFACE still makes its
 //    least-squares tangent arc, and so does Quick Scan. The lines are
 //    separate, so the join and the fillet are two undo steps.
 const before3=(await read());
 await sweep([[21.5,0],[9.5,0],[9.5,16.5],[21.5,16.5]]);
 s=(await read()).sketch;
 const msg2=await page.$eval('[data-test=corner-message]',e=>e.textContent).catch(()=>null);
 assert.ok(!s.entities.some(e=>e.kind==='spline'),'no free blend');
 const arc2=s.entities.find(e=>e.kind==='arc'&&e.c[1]>0);assert.ok(arc2,'ellipse corner rounded: '+msg2);
 assert.ok(Math.abs(arc2.r-4.565)<0.01,`ellipse arc radius ${arc2.r}`);
 const fitText2=await page.$eval('[data-test=corner-last-fit]',e=>e.textContent);assert.match(fitText2,/Fillet R 4\.5\d* mm/);
 assert.equal((await read()).history,before3.history+2,'join, then fillet: two undo steps');
 results.ellipse={arc:arc2,fitText:fitText2};
 await page.screenshot({path:out+'/04-ellipse-arc.png'});
 // 4. Undo, Undo, Redo, Redo.
 const done=(await read()).sketch;
 await page.click('[data-test=undo]');await sleep(300);
 s=(await read()).sketch;
 {assert.ok(!s.entities.some(e=>e.kind==='arc'&&e.c[1]>0),'first undo removes the fillet');
  const r=s.entities.find(e=>e.id===2),t=s.entities.find(e=>e.id===3);
  assert.ok(Math.hypot(r.b[0]-W,r.b[1]-H)<1e-7&&Math.hypot(t.a[0]-W,t.a[1]-H)<1e-7,'and leaves the lines joined at (20,15)')}
 await page.click('[data-test=undo]');await sleep(300);assert.deepEqual((await read()).sketch,before3.sketch,'second undo restores the separate lines');
 await page.click('[data-test=redo]');await sleep(300);await page.click('[data-test=redo]');await sleep(300);assert.deepEqual((await read()).sketch,done,'redo twice restores the fillet');
 await page.$eval('[data-test=corner-cancel]',e=>e.click());
 fs.writeFileSync(out+'/result.json',JSON.stringify({passed:true,...results},null,2));
 assert.deepEqual(consoleErrors,[]);console.log('PASS corner sweep:',results.trim.heldPixels,'px held,',fitText,',',fitText2,'(ellipse)');
}catch(e){await page.screenshot({path:out+'/failure.png'});console.log(await page.evaluate(()=>document.body.innerText.slice(-1500)));throw e;}finally{await browser.close()}
