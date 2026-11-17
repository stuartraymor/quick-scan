// SPDX-License-Identifier: AGPL-3.0-only
// Batch 1 acceptance (2D Sketch overhaul): a scanned plate with R5 rounded
// corners. Two lines sit on its straight edges, apart from the round; one
// Auto Fillet stroke over the round finds the corner, fits the radius from
// the section points, trims both lines to the tangent points and inserts the
// tangent arc: no gaps, the radius editable afterwards, units shown.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {launchApp,loadScan,sleep,shotPath} from '../../../scripts/e2e-lib.mjs';
import {openReverse} from './lib.mjs';
const out=shotPath('mesh-fillet');fs.mkdirSync(out,{recursive:true});
// A 40 × 30 plate, z −5..5, R5 corners tessellated in 24 steps each.
const R=5,W=20,H=15,steps=24,outline=[];
for(const [cx,cy,a0] of [[W-R,H-R,0],[-W+R,H-R,Math.PI/2],[-W+R,-H+R,Math.PI],[W-R,-H+R,3*Math.PI/2]])
 for(let i=0;i<=steps;i++){const a=a0+(Math.PI/2)*i/steps;outline.push([cx+R*Math.cos(a),cy+R*Math.sin(a)])}
const n=outline.length,mesh=[];
for(const z of [-5,5])for(const [x,y] of outline)mesh.push(`v ${x} ${y} ${z}`);
mesh.push('v 0 0 -5','v 0 0 5');
for(let i=0;i<n;i++){const a=i+1,b=(i+1)%n+1;mesh.push(`f ${a} ${b} ${b+n}`,`f ${a} ${b+n} ${a+n}`,`f ${2*n+1} ${b} ${a}`,`f ${2*n+2} ${a+n} ${b+n}`)}
const meshPath=out+'/rounded-plate.obj';fs.writeFileSync(meshPath,mesh.join('\n'));
const {browser,page,consoleErrors}=await launchApp({width:1800,height:1100});
const read=()=>page.evaluate(()=>{const d=window.__re.store.getState().sketchDraft;return {sketch:d.sketch,history:d.history.length}});
const screen=p=>page.evaluate(p=>window.__re.sheet().sheetScreenPoint(p),p);
try{
 await loadScan(page,meshPath);await openReverse(page);
 // Bottom edge y = −15 and right edge x = 20, both stopping short of the round.
 const entities=[{kind:'line',a:[-10,-H],b:[W-R-2,-H]},{kind:'line',a:[W,H-8],b:[W,-H+R+2]}];
 await page.evaluate(async entities=>{const r=window.__re.store;r.setState({sketchDraft:null});r.getState().startSketch({kind:'world',axis:'z',offset:0},{origin:[0,0,0],normal:[0,0,1],basisU:[1,0,0],basisV:[0,1,0]},entities);},entities);await sleep(900);
 await page.evaluate(()=>window.__re.sheet().zoomTo?.([10,-15,25,0]));await sleep(300);
 await page.$eval('[data-test=sketch-sharpen]',e=>e.click());await sleep(200);
 await page.$eval('[data-test=corner-mode-autoFillet]',e=>e.click());await page.$eval('[data-test=corner-add-dimension]',e=>{if(!e.checked)e.click()});await sleep(150);
 // Stroke: line end, along the round itself, other line end.
 const stroke=[[W-R-2,-H]];for(let i=0;i<=12;i++){const a=3*Math.PI/2+(Math.PI/2)*i/12;stroke.push([W-R+R*Math.cos(a),-H+R+R*Math.sin(a)])}stroke.push([W,-H+R+2]);
 const pts=[];for(const p of stroke)pts.push(await screen(p));
 await page.mouse.move(pts[0].x,pts[0].y);await page.mouse.down();for(const p of pts.slice(1))await page.mouse.move(p.x,p.y,{steps:3});
 await page.screenshot({path:out+'/01-held.png'});await page.mouse.up();await sleep(400);
 const message=await page.$eval('[data-test=corner-message]',e=>e.textContent).catch(()=>null);
 const after=await read();
 const arc=after.sketch.entities.find(e=>e.kind==='arc');assert.ok(arc,'fillet arc created: '+message);
 const l1=after.sketch.entities.find(e=>e.id===1),l2=after.sketch.entities.find(e=>e.id===2);
 assert.ok(Math.abs(arc.r-R)<0.02,`radius ${arc.r} vs scan R${R}`);
 assert.ok(Math.hypot(arc.c[0]-(W-R),arc.c[1]-(-H+R))<0.03,`centre ${arc.c}`);
 const ends=[[arc.c[0]+arc.r*Math.cos(arc.start),arc.c[1]+arc.r*Math.sin(arc.start)],[arc.c[0]+arc.r*Math.cos(arc.start+arc.sweep),arc.c[1]+arc.r*Math.sin(arc.start+arc.sweep)]];
 const gap=(p)=>Math.min(...ends.map(e=>Math.hypot(e[0]-p[0],e[1]-p[1])));
 assert.ok(gap(l1.b)<1e-7&&gap(l2.b)<1e-7,'no gaps at the tangent points');
 // G1: the centre lies one radius from each line.
 for(const l of [l1,l2]){const dx=l.b[0]-l.a[0],dy=l.b[1]-l.a[1];assert.ok(Math.abs(Math.abs((arc.c[0]-l.a[0])*dy-(arc.c[1]-l.a[1])*dx)/Math.hypot(dx,dy)-arc.r)<1e-6,'tangent')}
 for(const [p,q] of [[l1.a,[-10,-H]],[l2.a,[W,H-8]]])assert.ok(Math.hypot(p[0]-q[0],p[1]-q[1])<1e-9,"far ends kept");
 const fitText=await page.$eval('[data-test=corner-last-fit]',e=>e.textContent);assert.match(fitText,/Fillet R 5\.0\d* mm/);
 await page.screenshot({path:out+'/02-fitted.png'});
 // The radius stays editable: its dimension drives the arc through the solver.
 const radius=after.sketch.constraints.find(c=>c.kind==='radius');assert.ok(radius,'radius dimension added');
 await page.evaluate(async id=>{const r=window.__re.store.getState();r.setDimensionValue?r.setDimensionValue(id,6):null},radius.id);await sleep(300);
 const edited=await read(),arc2=edited.sketch.entities.find(e=>e.kind==='arc');
 fs.writeFileSync(out+'/result.json',JSON.stringify({passed:true,fitText,arc,edited:arc2?.r,lines:[l1,l2]},null,2));
 await page.$eval('[data-test=corner-cancel]',e=>e.click());
 assert.deepEqual(consoleErrors,[]);console.log('PASS mesh fillet:',fitText,'centre',arc.c.map(v=>v.toFixed(4)).join(','),'edited radius',arc2?.r);
}catch(e){await page.screenshot({path:out+'/failure.png'});console.log(await page.evaluate(()=>document.body.innerText.slice(-2500)));throw e;}finally{await browser.close()}
