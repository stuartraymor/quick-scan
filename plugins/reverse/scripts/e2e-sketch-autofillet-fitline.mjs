// SPDX-License-Identifier: AGPL-3.0-only
// Auto Fillet end to end through the UI, as in QUICKSURFACE: the lines are
// fitted by brushing the section with Fit Line (Instant Fit), not placed by
// script, then Corner Trim → Auto Fillet is swept over each corner point.
// plate-dense (analysis/corner-sweep-2026-11-19) is the mesh QUICKSURFACE
// 8.0.128 read R 5.004061 (R5 round) and R 4.565252 (3 x 9 ellipse) on.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {launchApp,loadScan,sleep,shotPath} from '../../../scripts/e2e-lib.mjs';
import {openReverse,reverseHelpers} from './lib.mjs';
const out=shotPath('autofillet-fitline');fs.mkdirSync(out,{recursive:true});
const R=5,W=20,H=15,o=[];
const seg=(a,b)=>{const n=Math.max(1,Math.round(Math.hypot(b[0]-a[0],b[1]-a[1])/0.5));for(let i=0;i<n;i++)o.push([a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n])};
seg([-W,-H],[W-R,-H]);
for(let i=0;i<24;i++){const a=-Math.PI/2+(Math.PI/2)*i/24;o.push([W-R+R*Math.cos(a),-H+R+R*Math.sin(a)])}
seg([W,-H+R],[W,H-9]);
for(let i=0;i<32;i++){const a=(Math.PI/2)*i/32;o.push([W-3+3*Math.cos(a),H-9+9*Math.sin(a)])}
seg([W-3,H],[-W,H]);seg([-W,H],[-W,-H]);
const n=o.length,m=[];
for(const z of [-5,5])for(const [x,y] of o)m.push(`v ${x} ${y} ${z}`);
m.push('v 0 0 -5','v 0 0 5');
for(let i=0;i<n;i++){const a=i+1,b=(i+1)%n+1;m.push(`f ${a} ${b} ${b+n}`,`f ${a} ${b+n} ${a+n}`,`f ${2*n+1} ${b} ${a}`,`f ${2*n+2} ${a+n} ${b+n}`)}
const meshPath=out+'/plate-dense.obj';fs.writeFileSync(meshPath,m.join('\n'));
const NATIVE={round:5.004061,ellipse:4.565252};
const {browser,page,consoleErrors}=await launchApp({width:1800,height:1100});
const {re}=reverseHelpers(page);
const sketch=()=>page.evaluate(()=>window.__re.store.getState().sketchDraft.sketch);
const history=()=>page.evaluate(()=>window.__re.store.getState().sketchDraft.history.length);
const screen=p=>page.evaluate(p=>window.__re.sheet().sheetScreenPoint(p),p);
const drag=async(path,shot)=>{const pts=[];for(const p of path)pts.push(await screen(p));await page.mouse.move(pts[0].x,pts[0].y);await page.mouse.down();for(const p of pts.slice(1))await page.mouse.move(p.x,p.y,{steps:12});await sleep(200);if(shot)await page.screenshot({path:`${out}/${shot}.png`});await page.mouse.up();await sleep(500)};
const lines=async()=>(await sketch()).entities.filter(e=>e.kind==='line');
const result={native:NATIVE};
try{
 await loadScan(page,meshPath);await openReverse(page);
 if(await page.$('[data-test=support-card] .sc-x'))await page.$eval('[data-test=support-card] .sc-x',e=>e.click());
 await re(async()=>{
  window.__brush=(await import('/plugins/reverse/state/sketchBrushStore.ts')).useSketchBrush;
  const r=window.__re.store;r.setState({sketchDraft:null});
  r.getState().startSketch({kind:'world',axis:'z',offset:0},{origin:[0,0,0],normal:[0,0,1],basisU:[1,0,0],basisV:[0,1,0]});
 });
 await page.waitForSelector('[data-test=sketch-extract]');await sleep(1200);
 await page.evaluate(()=>window.__re.sheet().zoomTo?.([-24,-19,24,19]));await sleep(300);
 // Extract primitives → Fit Line, Instant Fit: each brush stroke fits a line
 // to the section points it paints, on release.
 await page.$eval('[data-test=sketch-extract]',e=>e.click());
 await page.waitForSelector('[data-test=sketch-fit-brush-overlay]');await sleep(300);
 await re(()=>window.__brush.setState({primitive:'line',instant:true}));
 const strokes={bottom:[[-15,-H],[9,-H]],right:[[W,-7],[W,3]],top:[[13,H],[-12,H]]};
 for(const [name,[a,b]] of Object.entries(strokes)){
  const path=Array.from({length:21},(_,i)=>[a[0]+(b[0]-a[0])*i/20,a[1]+(b[1]-a[1])*i/20]);
  await drag(path,'01-brush-'+name);
 }
 const fitted=await lines();
 assert.equal(fitted.length,3,'three lines fitted by brushing: '+JSON.stringify(fitted.map(l=>[l.a,l.b])));
 const on=(l,test)=>test(l.a)&&test(l.b);
 const bottom=fitted.find(l=>on(l,p=>Math.abs(p[1]+H)<1e-3)),right=fitted.find(l=>on(l,p=>Math.abs(p[0]-W)<1e-3)),top=fitted.find(l=>on(l,p=>Math.abs(p[1]-H)<1e-3));
 assert.ok(bottom&&right&&top,'each line lies on its flat');
 result.fitted={bottom:[bottom.a,bottom.b],right:[right.a,right.b],top:[top.a,top.b]};
 await page.screenshot({path:out+'/02-fitted.png'});
 await page.$eval('[data-test=sketch-fit-back]',e=>e.click());await sleep(300);
 // Edit Sketch → Corner Trim → Auto Fillet.
 await page.$eval('[data-test=sketch-sharpen]',e=>e.click());await sleep(200);
 await page.$eval('[data-test=corner-mode-autoFillet]',e=>e.click());await page.$eval('[data-test=corner-add-dimension]',e=>{if(!e.checked)e.click()});await sleep(150);
 // The R5 corner: one sweep over both line ends and the corner point.
 let h=await history();
 await drag([[8,-17],[8,-5],[22,-5],[22,-17]],'03-round-held');
 let s=await sketch();const arc=s.entities.find(e=>e.kind==='arc'&&e.c[1]<0);
 assert.ok(arc,'round created: '+await page.$eval('[data-test=corner-message]',e=>e.textContent).catch(()=>null));
 result.round={quickScan:arc.r,difference:arc.r-NATIVE.round,fitText:await page.$eval('[data-test=corner-last-fit]',e=>e.textContent)};
 assert.equal(await history(),h+2,'join, then fillet');
 await page.screenshot({path:out+'/04-round.png'});
 // The elliptical corner.
 h=await history();
 await drag([[21.5,0],[12,0],[12,16.5],[21.5,16.5]],'05-ellipse-held');
 s=await sketch();const arc2=s.entities.find(e=>e.kind==='arc'&&e.c[1]>0);
 assert.ok(arc2,'ellipse corner rounded: '+await page.$eval('[data-test=corner-message]',e=>e.textContent).catch(()=>null));
 result.ellipse={quickScan:arc2.r,difference:arc2.r-NATIVE.ellipse,fitText:await page.$eval('[data-test=corner-last-fit]',e=>e.textContent)};
 assert.equal(await history(),h+2,'join, then fillet');
 assert.equal(s.constraints.filter(c=>c.kind==='tangent').length,4,'tangent at all four ends');
 await page.screenshot({path:out+'/06-ellipse.png'});
 fs.writeFileSync(out+'/result.json',JSON.stringify(result,null,2));
 assert.ok(Math.abs(arc.r-NATIVE.round)<5e-5,`R5 corner ${arc.r} vs native ${NATIVE.round}`);
 assert.ok(Math.abs(arc2.r-NATIVE.ellipse)<5e-5,`ellipse corner ${arc2.r} vs native ${NATIVE.ellipse}`);
 // Undo walks back fillet, join, fillet, join; Redo forward again.
 const done=await sketch();
 for(let i=0;i<4;i++){await page.click('[data-test=undo]');await sleep(250)}
 s=await sketch();assert.ok(!s.entities.some(e=>e.kind==='arc'),'four undos remove both fillets and joins');
 assert.deepEqual(s.entities.filter(e=>e.kind==='line').map(l=>[l.a,l.b]),fitted.map(l=>[l.a,l.b]),'back to the fitted lines');
 for(let i=0;i<4;i++){await page.click('[data-test=redo]');await sleep(250)}
 assert.deepEqual(await sketch(),done,'four redos restore both fillets');
 await page.$eval('[data-test=corner-cancel]',e=>e.click());
 assert.deepEqual(consoleErrors,[]);console.log('PASS autofillet fit-line:',JSON.stringify(result));
}catch(e){await page.screenshot({path:out+'/failure.png'});fs.writeFileSync(out+'/result.json',JSON.stringify({passed:false,error:String(e),...result},null,2));console.log(await page.evaluate(()=>document.body.innerText.slice(-1500)));throw e;}finally{await browser.close()}
