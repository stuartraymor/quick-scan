// SPDX-License-Identifier: AGPL-3.0-only
// Corner Trim, Auto Fillet and Fixed Size Fillet in the GUI on pieces brushed
// in the GUI: QUICKSURFACE's example scan basic_part, aligned as the user
// aligned it (cylinder on Z, flat face up), cut across the cylinder. The flat
// is brushed with Fit Line and the cylinder with Fit Arc, by mouse, and the
// corner between them is swept with each tool.
//
// This is the corner 1.2.6 refused ("This operation would move a far end.
// Nothing was changed."): a brushed arc keeps its section points, and the
// solve the corner ran refitted the arc to them and moved it. Each tool must
// now make its corner, leave both pieces on the carriers they were fitted
// to, and undo in one step (a join) or two (a fillet).
// Usage: node e2e-sketch-corner-fitted.mjs [basic_part_aligned.stl]
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {launchApp,loadScan,sleep,shotPath} from '../../../scripts/e2e-lib.mjs';
import {openReverse,reverseHelpers} from './lib.mjs';
const mesh=process.argv[2]??'analysis/autofillet/basic_part_aligned.stl';
if(!fs.existsSync(mesh)){console.log('SKIP corner fitted: aligned scan missing ('+mesh+')');process.exit(0)}
const out=shotPath('corner-fitted');fs.mkdirSync(out,{recursive:true});
const {browser,page,consoleErrors}=await launchApp({width:1800,height:1100});
const {re}=reverseHelpers(page);
const sketch=()=>page.evaluate(()=>window.__re.store.getState().sketchDraft.sketch);
const history=()=>page.evaluate(()=>window.__re.store.getState().sketchDraft.history.length);
const screen=p=>page.evaluate(p=>window.__re.sheet().sheetScreenPoint(p),p);
const drag=async(path,shot)=>{const pts=[];for(const p of path)pts.push(await screen(p));await page.mouse.move(pts[0].x,pts[0].y);await page.mouse.down();for(const p of pts.slice(1))await page.mouse.move(p.x,p.y,{steps:8});await sleep(250);if(shot)await page.screenshot({path:`${out}/${shot}.png`});await page.mouse.up();await sleep(700)};
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const endsOf=e=>e.kind==='line'?[e.a,e.b]:[[e.c[0]+e.r*Math.cos(e.start),e.c[1]+e.r*Math.sin(e.start)],[e.c[0]+e.r*Math.cos(e.start+e.sweep),e.c[1]+e.r*Math.sin(e.start+e.sweep)]];
const results=[];
try{
 await loadScan(page,mesh);await openReverse(page);
 if(await page.$('[data-test=support-card] .sc-x'))await page.$eval('[data-test=support-card] .sc-x',e=>e.click());
 // A tidy pair of strokes, then a sloppy pair that starts in the corner and takes in strays.
 for(const [offset,lineFrom,arcFrom] of [[20,4,2],[35,0.5,0.5]]){
  await re((offset)=>{const r=window.__re.store;r.setState({sketchDraft:null});r.getState().startSketchOn({kind:'world',axis:'z',offset})},offset);
  await page.waitForSelector('[data-test=sketch-extract]');await sleep(2500);
  const chains=await page.evaluate(()=>window.__re.chains()?.chains??[]);
  const all=chains.flat(),top=Math.max(...all.map(p=>p[1]));
  const flat=all.filter(p=>p[1]>top-1.5).map(p=>p[1]).sort((a,b)=>a-b),level=flat[Math.floor(flat.length/2)],R=100.09;
  const corner=[Math.sqrt(R*R-level*level),level],cornerAngle=Math.atan2(level,corner[0]);
  // Fit Line on the flat and Fit Arc on the cylinder, each one brush stroke.
  await page.$eval('[data-test=sketch-extract]',e=>e.click());
  await page.waitForSelector('[data-test=sketch-fit-brush-overlay]');await sleep(300);
  await page.$eval('[data-test=sketch-fit-line]',e=>e.click());await sleep(150);
  await drag(Array.from({length:21},(_,i)=>[corner[0]-lineFrom-60*i/20,level]),`z${offset}-01-fit-line`);
  await page.$eval('[data-test=sketch-fit-arc]',e=>e.click());await sleep(150);
  await drag(Array.from({length:25},(_,i)=>{const a=cornerAngle-(arcFrom+40*i/24)*Math.PI/180;return [R*Math.cos(a),R*Math.sin(a)]}),`z${offset}-02-fit-arc`);
  const fitted=await sketch();
  const line=fitted.entities.find(e=>e.kind==='line'),arc=fitted.entities.find(e=>e.kind==='arc');
  assert.ok(line&&arc&&fitted.entities.length===2,'a line and an arc brushed: '+JSON.stringify(fitted.entities.map(e=>e.kind)));
  assert.ok(arc.points?.length>10&&line.points?.length>=2,'both pieces keep the section points they were fitted to');
  await page.$eval('[data-test=sketch-fit-back]',e=>e.click());await sleep(300);
  await page.$eval('[data-test=sketch-sharpen]',e=>e.click());await sleep(200);
  // The carriers' crossing next the scan corner: the corner point to paint over.
  const lc=arc.c,h2=arc.r*arc.r-(line.a[1]-lc[1])**2;assert.ok(h2>0,'the brushed line meets the brushed arc');
  const cross=[lc[0]+Math.sqrt(h2),line.a[1]];
  const nearL=endsOf(line).sort((p,q)=>dist(p,cross)-dist(q,cross))[0],nearA=endsOf(arc).sort((p,q)=>dist(p,cross)-dist(q,cross))[0];
  const farL=endsOf(line).sort((p,q)=>dist(q,cross)-dist(p,cross))[0],farA=endsOf(arc).sort((p,q)=>dist(q,cross)-dist(p,cross))[0];
  for(const mode of ['trim','autoFillet','fixedFillet']){
   await page.$eval(`[data-test=corner-mode-${mode}]`,e=>e.click());await sleep(150);
   if(mode==='fixedFillet'){const input=await page.$('[data-test=corner-radius]');if(input){await input.focus();await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');await page.keyboard.type('2');await page.keyboard.press('Tab');await sleep(150)}}
   const h=await history(),start=await sketch();
   // Sweep from the line's end, across the corner point, to the arc's end.
   await drag([nearL,[(nearL[0]+cross[0])/2,cross[1]+0.6],[cross[0]+0.6,cross[1]+0.6],[cross[0]+0.6,(cross[1]+nearA[1])/2],nearA],`z${offset}-03-${mode}-held`);
   const msg=await page.$eval('[data-test=corner-message]',e=>e.textContent).catch(()=>null);
   const accept=await page.$('[data-test=corner-accept]');if(accept){await accept.click();await sleep(400)}
   const s=await sketch(),steps=(await history())-h;
   await page.screenshot({path:`${out}/z${offset}-04-${mode}.png`});
   assert.ok(steps>0,`${mode} at z${offset} changed nothing: ${msg}`);
   const l2=s.entities.find(e=>e.id===line.id),a2=s.entities.find(e=>e.id===arc.id),fillet=s.entities.find(e=>e.kind==='arc'&&e.id!==arc.id);
   // Both pieces still on the carriers they were fitted to, far ends where they were.
   assert.ok(Math.abs(l2.a[1]-line.a[1])<1e-9&&Math.abs(l2.b[1]-line.b[1])<1e-9,`${mode}: the line stays on its carrier`);
   assert.ok(dist(a2.c,arc.c)<1e-9&&Math.abs(a2.r-arc.r)<1e-9,`${mode}: the arc stays on its carrier (moved ${dist(a2.c,arc.c)})`);
   assert.ok(Math.min(...endsOf(l2).map(p=>dist(p,farL)))<1e-9&&Math.min(...endsOf(a2).map(p=>dist(p,farA)))<1e-9,`${mode}: far ends stay`);
   if(mode==='trim'){
    assert.ok(!fillet&&steps===1,'Corner Trim: a join, one undo step');
    assert.ok(Math.min(...endsOf(l2).map(p=>dist(p,cross)))<1e-7&&Math.min(...endsOf(a2).map(p=>dist(p,cross)))<1e-7,'Corner Trim: both pieces end at the corner point');
   }
   if(mode==='fixedFillet'){
    assert.ok(fillet&&steps===2,'Fixed Size Fillet: a join, then a fillet');
    assert.ok(Math.abs(fillet.r-2)<1e-9,`Fixed Size Fillet radius ${fillet.r}`);
    assert.equal(s.constraints.filter(k=>k.kind==='tangent'&&(k.a===fillet.id||k.b===fillet.id)).length,2,'tangent to the line and the arc');
   }
   if(fillet)for(const piece of [l2,a2])assert.ok(Math.min(...endsOf(piece).flatMap(p=>endsOf(fillet).map(q=>dist(p,q))))<1e-6,`${mode}: the fillet meets both pieces`);
   results.push({section:'z'+offset,strokesFrom:[lineFrom,arcFrom],fittedArcRadius:arc.r,mode,message:msg,steps,fillet:fillet?fillet.r:null});
   for(let i=0;i<steps;i++){await page.click('[data-test=undo]');await sleep(250)}
   assert.deepEqual(await sketch(),start,`${mode}: undo restores the brushed pieces`);
  }
  await page.click('[data-test=corner-cancel]').catch(()=>{});await sleep(200);
 }
 fs.writeFileSync(out+'/result.json',JSON.stringify(results,null,2));
 assert.deepEqual(consoleErrors,[]);console.log('PASS corner fitted:',results.map(r=>`${r.section} ${r.mode} ${r.fillet?'R '+r.fillet.toFixed(4):'join'} (${r.steps} step${r.steps>1?'s':''})`).join('; '));
}catch(e){await page.screenshot({path:out+'/failure.png'});fs.writeFileSync(out+'/result.json',JSON.stringify(results,null,2));console.log(await page.evaluate(()=>document.body.innerText.slice(-900)));throw e;}finally{await browser.close()}
