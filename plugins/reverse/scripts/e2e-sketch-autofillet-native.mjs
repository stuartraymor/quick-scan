// SPDX-License-Identifier: AGPL-3.0-only
// Auto Fillet against QUICKSURFACE 8.0.128 on the same mesh. plate-dense: a
// 40 × 30 × 10 plate, bottom-right R5 round tessellated in 24 steps, flats
// split every 0.5 mm. QUICKSURFACE, with lines fitted to the bottom and right
// sides and one Auto Fillet sweep over both line ends and the round, creates
// "R: 5.004061 mm" (analysis/corner-sweep-2026-11-19/native-21). Quick Scan
// slices the same mesh with its own sketch plane and must read the same round.
// Also as measured natively on this mesh: the top-right 3 x 9 elliptical
// corner gives an arc of R 4.565252 mm; a sweep that paints the round but
// not the corner point joins the lines sharp; a fillet between separate lines
// is two undo steps (the join, then the fillet).
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {launchApp,loadScan,sleep,shotPath} from '../../../scripts/e2e-lib.mjs';
import {openReverse} from './lib.mjs';
const out=shotPath('autofillet-native');fs.mkdirSync(out,{recursive:true});
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
const NATIVE=5.004061;
const {browser,page,consoleErrors}=await launchApp({width:1800,height:1100});
const read=()=>page.evaluate(()=>window.__re.store.getState().sketchDraft.sketch);
const history=()=>page.evaluate(()=>window.__re.store.getState().sketchDraft.history.length);
const NATIVE_ELLIPSE=4.565252;
const screen=p=>page.evaluate(p=>window.__re.sheet().sheetScreenPoint(p),p);
const sweep=async(path,shot='01-held')=>{const pts=[];for(const p of path)pts.push(await screen(p));await page.mouse.move(pts[0].x,pts[0].y);await page.mouse.down();for(const p of pts.slice(1))await page.mouse.move(p.x,p.y,{steps:10});await sleep(200);await page.screenshot({path:`${out}/${shot}.png`});await page.mouse.up();await sleep(500)};
try{
 await loadScan(page,meshPath);await openReverse(page);
 // Lines as QUICKSURFACE's Fit Line left them: on the flats, short of the round.
 const entities=[{kind:'line',a:[-12,-H],b:[11,-H]},{kind:'line',a:[W,4],b:[W,-6.5]},{kind:'line',a:[14,H],b:[-12,H]}];
 await page.evaluate(async entities=>{const r=window.__re.store;r.setState({sketchDraft:null});r.getState().startSketch({kind:'world',axis:'z',offset:0},{origin:[0,0,0],normal:[0,0,1],basisU:[1,0,0],basisV:[0,1,0]},entities);},entities);await sleep(900);
 await page.evaluate(()=>window.__re.sheet().zoomTo?.([-24,-19,24,19]));await sleep(300);
 await page.$eval('[data-test=sketch-sharpen]',e=>e.click());await sleep(200);
 await page.$eval('[data-test=corner-mode-autoFillet]',e=>e.click());await page.$eval('[data-test=corner-add-dimension]',e=>{if(!e.checked)e.click()});await sleep(150);
 // The round painted but not the corner point: the lines are joined sharp.
 const h0=await history(),start=await read();
 await sweep([[10.5,-15.5],[10.5,-5],[20.6,-5],[20.6,-14.2]],'00-round-not-corner-held');
 {const t=await read();assert.ok(!t.entities.some(e=>e.kind==='arc'),'no fillet without the corner point');
  const a=t.entities.find(e=>e.id===1),b=t.entities.find(e=>e.id===2);assert.ok(Math.hypot(a.b[0]-W,a.b[1]+H)<1e-7&&Math.hypot(b.b[0]-W,b.b[1]+H)<1e-7,'joined at (20,-15)');
  assert.equal(await history(),h0+1,'a sharp join is one step');
  assert.match(await page.$eval('[data-test=corner-message]',e=>e.textContent),/Paint over the corner point/);}
 await page.screenshot({path:out+'/00b-round-not-corner.png'});
 await page.click('[data-test=undo]');await sleep(300);assert.deepEqual(await read(),start,'undo restores the separate lines');
 // One sweep over both line ends and the round, as on the native side.
 const h1=await history();
 await sweep([[10,-17],[10,-5],[22,-5],[22,-17]]);
 const s=await read();const arc=s.entities.find(e=>e.kind==='arc');
 const msg=await page.$eval('[data-test=corner-message]',e=>e.textContent).catch(()=>null);
 assert.ok(arc,'round created: '+msg);
 const fitText=await page.$eval('[data-test=corner-last-fit]',e=>e.textContent);
 await page.screenshot({path:out+'/02-round.png'});
 const result={native:NATIVE,quickScan:arc.r,difference:arc.r-NATIVE,centre:arc.c,fitText,message:msg};
 fs.writeFileSync(out+'/result.json',JSON.stringify(result,null,2));
 assert.ok(Math.abs(arc.r-NATIVE)<5e-5,`radius ${arc.r} vs native ${NATIVE}`);
 assert.ok(s.constraints.filter(c=>c.kind==='tangent').length>=2,'tangent at both ends');
 assert.equal(await history(),h1+2,'join, then fillet: two undo steps');
 // The 3 x 9 elliptical corner: QUICKSURFACE R 4.565252.
 const h2=await history();
 await sweep([[21.5,0],[13,0],[13,16.5],[21.5,16.5]],'03-ellipse-held');
 const e=await read(),arc2=e.entities.find(x=>x.kind==='arc'&&x.c[1]>0);
 const msg2=await page.$eval('[data-test=corner-message]',x=>x.textContent).catch(()=>null);
 assert.ok(arc2,'ellipse corner rounded: '+msg2);
 assert.ok(!e.entities.some(x=>x.kind==='spline'),'an arc, never a free blend');
 result.ellipse={native:NATIVE_ELLIPSE,quickScan:arc2.r,difference:arc2.r-NATIVE_ELLIPSE,fitText:await page.$eval('[data-test=corner-last-fit]',x=>x.textContent)};
 fs.writeFileSync(out+'/result.json',JSON.stringify(result,null,2));
 await page.screenshot({path:out+'/04-ellipse.png'});
 assert.ok(Math.abs(arc2.r-NATIVE_ELLIPSE)<5e-5,`ellipse radius ${arc2.r} vs native ${NATIVE_ELLIPSE}`);
 assert.equal(await history(),h2+2,'ellipse: join, then fillet');
 assert.deepEqual(consoleErrors,[]);console.log('PASS autofillet native:',JSON.stringify(result));
}catch(e){await page.screenshot({path:out+'/failure.png'});console.log(await page.evaluate(()=>document.body.innerText.slice(-1200)));throw e;}finally{await browser.close()}
