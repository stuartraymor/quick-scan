// SPDX-License-Identifier: AGPL-3.0-only
// Auto Fillet between a line and an arc, and between two arcs, in the GUI.
// The test plate's outline: a flat bottom; an R3 round into a convex R27
// side arc; an R2.5 round into a convex R45 top arc; a sharp corner into the
// flat left side. A line and two arcs are put on the flats and the arcs
// short of the rounds, and each corner is swept in Corner Trim's Auto Fillet:
// the round read off the section must be the one the plate was made with,
// tangent at both ends, in two undo steps (the join, then the fillet).
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {launchApp,loadScan,sleep,shotPath} from '../../../scripts/e2e-lib.mjs';
import {openReverse} from './lib.mjs';
const out=shotPath('autofillet-arcs');fs.mkdirSync(out,{recursive:true});
const C1=[-5,0],R1=27,C2=[0,-30],R2=45,F1=3,F2=2.5;
const ang=(c,p)=>Math.atan2(p[1]-c[1],p[0]-c[0]),at=(c,r,a)=>[c[0]+r*Math.cos(a),c[1]+r*Math.sin(a)];
// Round 1: line y = -15 and circle C1, inside both.
const P1=[C1[0]+Math.sqrt((R1-F1)**2-(15-F1)**2),-15+F1],T1a=[P1[0],-15],T1b=at(C1,R1,ang(C1,P1));
// Round 2: inside C1 and inside C2: centre where |P-C1| = R1-F2 and |P-C2| = R2-F2 (upper right).
const meet=(c1,r1,c2,r2)=>{const d=Math.hypot(c2[0]-c1[0],c2[1]-c1[1]),a=(r1*r1-r2*r2+d*d)/(2*d),h=Math.sqrt(r1*r1-a*a),u=[(c2[0]-c1[0])/d,(c2[1]-c1[1])/d],m=[c1[0]+u[0]*a,c1[1]+u[1]*a];return [[m[0]-u[1]*h,m[1]+u[0]*h],[m[0]+u[1]*h,m[1]-u[0]*h]]};
const P2=meet(C1,R1-F2,C2,R2-F2).sort((p,q)=>q[0]+q[1]-(p[0]+p[1]))[0],T2a=at(C1,R1,ang(C1,P2)),T2b=at(C2,R2,ang(C2,P2));
const topLeft=[-20,C2[1]+Math.sqrt(R2*R2-400)];
const o=[];
const seg=(a,b)=>{const n=Math.max(1,Math.round(Math.hypot(b[0]-a[0],b[1]-a[1])/0.5));for(let i=0;i<n;i++)o.push([a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n])};
const arc=(c,r,a0,a1,n)=>{n??=Math.max(2,Math.round(Math.abs(a1-a0)*r/0.5));for(let i=0;i<n;i++){const t=a0+(a1-a0)*i/n;o.push(at(c,r,t))}};
seg([-20,-15],T1a);arc(P1,F1,-Math.PI/2,ang(P1,T1b),16);arc(C1,R1,ang(C1,T1b),ang(C1,T2a));arc(P2,F2,ang(P2,T2a),ang(P2,T2b),16);arc(C2,R2,ang(C2,T2b),ang(C2,topLeft));seg(topLeft,[-20,-15]);
const n=o.length,m=[];
for(const z of [-5,5])for(const [x,y] of o)m.push(`v ${x} ${y} ${z}`);
m.push('v 0 0 -5','v 0 0 5');
for(let i=0;i<n;i++){const a=i+1,b=(i+1)%n+1;m.push(`f ${a} ${b} ${b+n}`,`f ${a} ${b+n} ${a+n}`,`f ${2*n+1} ${b} ${a}`,`f ${2*n+2} ${a+n} ${b+n}`)}
const meshPath=out+'/plate-arcs.obj';fs.writeFileSync(meshPath,m.join('\n'));
const {browser,page,consoleErrors}=await launchApp({width:1800,height:1100});
const read=()=>page.evaluate(()=>window.__re.store.getState().sketchDraft.sketch);
const history=()=>page.evaluate(()=>window.__re.store.getState().sketchDraft.history.length);
const screen=p=>page.evaluate(p=>window.__re.sheet().sheetScreenPoint(p),p);
const sweep=async(path,shot)=>{const pts=[];for(const p of path)pts.push(await screen(p));await page.mouse.move(pts[0].x,pts[0].y);await page.mouse.down();for(const p of pts.slice(1))await page.mouse.move(p.x,p.y,{steps:10});await sleep(200);await page.screenshot({path:`${out}/${shot}.png`});await page.mouse.up();await sleep(600)};
const box=(ps,g=1.5)=>{const xs=ps.map(p=>p[0]),ys=ps.map(p=>p[1]),x0=Math.min(...xs)-g,x1=Math.max(...xs)+g,y0=Math.min(...ys)-g,y1=Math.max(...ys)+g;return [[x0,y0],[x0,y1],[x1,y1],[x1,y0]]};
const result={};
try{
 await loadScan(page,meshPath);await openReverse(page);
 // A line on the bottom flat, the side arc between the two rounds, the top arc past round 2.
 const a1From=ang(C1,T1b)+0.12,a1To=ang(C1,T2a)-0.12,a2From=ang(C2,T2b)+0.06,a2To=ang(C2,topLeft)-0.1;
 const entities=[{kind:'line',a:[-12,-15],b:[11,-15]},{kind:'arc',c:C1,r:R1,start:a1From,sweep:a1To-a1From},{kind:'arc',c:C2,r:R2,start:a2From,sweep:a2To-a2From}];
 await page.evaluate(async entities=>{const r=window.__re.store;r.setState({sketchDraft:null});r.getState().startSketch({kind:'world',axis:'z',offset:0},{origin:[0,0,0],normal:[0,0,1],basisU:[1,0,0],basisV:[0,1,0]},entities);},entities);await sleep(900);
 await page.evaluate(()=>window.__re.sheet().zoomTo?.([-26,-20,30,22]));await sleep(300);
 await page.screenshot({path:out+'/00-start.png'});
 await page.$eval('[data-test=sketch-sharpen]',e=>e.click());await sleep(200);
 await page.$eval('[data-test=corner-mode-autoFillet]',e=>e.click());await page.$eval('[data-test=corner-add-dimension]',e=>{if(!e.checked)e.click()});await sleep(150);
 const start=await read();
 // Line to arc, over the line's end, the corner point and the arc's start.
 const corner1=[C1[0]+Math.sqrt(R1*R1-225),-15];
 const h1=await history();
 await sweep(box([[11,-15],corner1,at(C1,R1,a1From)]),'01-line-arc-held');
 {const s=await read(),f=s.entities.find(e=>e.kind==='arc'&&Math.abs(e.r-R1)>1&&Math.abs(e.r-R2)>1);
  const msg=await page.$eval('[data-test=corner-message]',e=>e.textContent).catch(()=>null);
  assert.ok(f,'line-arc round made: '+msg);
  result.lineArc={made:F1,quickScan:f.r,difference:f.r-F1,centre:f.c,expectedCentre:P1,fitText:await page.$eval('[data-test=corner-last-fit]',e=>e.textContent).catch(()=>null)};
  assert.ok(Math.abs(f.r-F1)<0.01,`line-arc radius ${f.r} vs ${F1}`);
  assert.ok(Math.hypot(f.c[0]-P1[0],f.c[1]-P1[1])<0.02,'centre where the plate round is');
  assert.ok(s.constraints.filter(c=>c.kind==='tangent'&&(c.a===f.id||c.b===f.id)).length===2,'tangent to the line and the arc');
  assert.equal(await history(),h1+2,'join, then fillet: two undo steps');}
 await page.screenshot({path:out+'/02-line-arc.png'});
 // Arc to arc, over the side arc's end, the corner point and the top arc's start.
 const corner2=meet(C1,R1,C2,R2).sort((p,q)=>q[0]+q[1]-(p[0]+p[1]))[0];
 const h2=await history();
 await sweep(box([at(C1,R1,a1To),corner2,at(C2,R2,a2From)]),'03-arc-arc-held');
 {const s=await read(),f=s.entities.find(e=>e.kind==='arc'&&Math.abs(e.r-F2)<0.5);
  const msg=await page.$eval('[data-test=corner-message]',e=>e.textContent).catch(()=>null);
  assert.ok(f,'arc-arc round made: '+msg);
  result.arcArc={made:F2,quickScan:f.r,difference:f.r-F2,centre:f.c,expectedCentre:P2,fitText:await page.$eval('[data-test=corner-last-fit]',e=>e.textContent).catch(()=>null)};
  assert.ok(Math.abs(f.r-F2)<0.01,`arc-arc radius ${f.r} vs ${F2}`);
  assert.ok(Math.hypot(f.c[0]-P2[0],f.c[1]-P2[1])<0.02,'centre where the plate round is');
  assert.equal(await history(),h2+2,'join, then fillet: two undo steps');}
 await page.screenshot({path:out+'/04-arc-arc.png'});
 // Undo all four steps: the pieces as they were.
 for(let i=0;i<4;i++){await page.click('[data-test=undo]');await sleep(250)}
 assert.deepEqual(await read(),start,'four undos restore the line and arcs');
 for(let i=0;i<4;i++){await page.click('[data-test=redo]');await sleep(250)}
 assert.equal((await read()).entities.filter(e=>e.kind==='arc').length,4,'redo brings both rounds back');
 fs.writeFileSync(out+'/result.json',JSON.stringify(result,null,2));
 assert.deepEqual(consoleErrors,[]);console.log('PASS autofillet arcs:',JSON.stringify(result));
}catch(e){await page.screenshot({path:out+'/failure.png'});fs.writeFileSync(out+'/result.json',JSON.stringify(result,null,2));console.log(await page.evaluate(()=>document.body.innerText.slice(-1200)));throw e;}finally{await browser.close()}
