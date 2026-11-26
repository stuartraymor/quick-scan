// SPDX-License-Identifier: AGPL-3.0-only
// Auto Fillet by painting over the corner point alone (1.2.29).
//
// QUICKSURFACE's hint is "paint over corner point". Lines brushed with Fit
// Line stop where the scan's round begins, short of that point. Before
// 1.2.29 a dab on the corner point that did not also reach both lines was
// refused ("Sweep across the two pieces that meet at the corner"), and the
// user found Auto Fillet worked about three times in four.
//
// plate-dense (analysis/corner-sweep-2026-11-19), on which QUICKSURFACE
// 8.0.128 read R 5.004061 (R5 round) and R 4.565252 (3 × 9 ellipse): three
// lines are brushed with Fit Line by mouse, each stopping well short of its
// corners. Then, in Auto Fillet, a small dab of the 7 px brush on each
// corner point, touching neither line, must make the fillet at once (no
// Accept), in two undo steps (join, fillet), at QUICKSURFACE's radius, with
// the lines left on their flats. A stroke from line to line over the corner
// point, the older way, must read the same radius.
import fs from 'node:fs';
import {launchApp,loadScan,sleep,shotPath} from '../../../scripts/e2e-lib.mjs';
import {openReverse} from './lib.mjs';
const out=shotPath('autofillet-dab');fs.mkdirSync(out,{recursive:true});
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
const sketch=()=>page.evaluate(()=>window.__re.store.getState().sketchDraft.sketch);
const history=()=>page.evaluate(()=>window.__re.store.getState().sketchDraft.history.length);
const screen=p=>page.evaluate(p=>window.__re.sheet().sheetScreenPoint(p),p);
const drag=async(path,shot)=>{const pts=[];for(const p of path)pts.push(await screen(p));await page.mouse.move(pts[0].x,pts[0].y);await page.mouse.down();for(const p of pts.slice(1))await page.mouse.move(p.x,p.y,{steps:12});await sleep(200);if(shot)await page.screenshot({path:`${out}/${shot}.png`});await page.mouse.up();await sleep(600)};
const dab=async(at,shot)=>{const c=await screen(at);await page.mouse.move(c.x+4,c.y);await page.mouse.down();for(let i=1;i<=12;i++)await page.mouse.move(c.x+4*Math.cos(i*Math.PI/6),c.y+4*Math.sin(i*Math.PI/6),{steps:2});await sleep(300);await page.screenshot({path:`${out}/${shot}.png`});await page.mouse.up();await sleep(700)};
const message=()=>page.$eval('[data-test=corner-message]',e=>e.textContent).catch(()=>null);
const results=[];
const check=(ok,what)=>{results.push({ok:Boolean(ok),what});console.log(ok?'PASS':'FAIL:',what)};
const record={native:NATIVE};
try{
 await loadScan(page,meshPath);await openReverse(page);
 if(await page.$('[data-test=support-card] .sc-x'))await page.$eval('[data-test=support-card] .sc-x',e=>e.click());
 await page.evaluate(()=>{const r=window.__re.store;r.setState({sketchDraft:null});r.getState().startSketch({kind:'world',axis:'z',offset:0},{origin:[0,0,0],normal:[0,0,1],basisU:[1,0,0],basisV:[0,1,0]})});
 await page.waitForSelector('[data-test=sketch-extract]');await sleep(1200);
 await page.evaluate(()=>window.__re.sheet().zoomTo?.([-24,-19,24,19]));await sleep(300);
 // Extract primitives → Fit Line: each brush stroke fits a line on release.
 await page.$eval('[data-test=sketch-extract]',e=>e.click());
 await page.waitForSelector('[data-test=sketch-fit-brush-overlay]');await sleep(300);
 await page.$eval('[data-test=sketch-fit-line]',e=>e.click());await sleep(150);
 const strokes={bottom:[[-15,-H],[9,-H]],right:[[W,-7],[W,3]],top:[[13,H],[-12,H]]};
 for(const [name,[a,b]] of Object.entries(strokes))await drag(Array.from({length:21},(_,i)=>[a[0]+(b[0]-a[0])*i/20,a[1]+(b[1]-a[1])*i/20]),'01-brush-'+name);
 const fitted=(await sketch()).entities.filter(e=>e.kind==='line');
 check(fitted.length===3,'three lines brushed with Fit Line by mouse');
 const on=(l,test)=>test(l.a)&&test(l.b);
 const bottom=fitted.find(l=>on(l,p=>Math.abs(p[1]+H)<1e-3)),right=fitted.find(l=>on(l,p=>Math.abs(p[0]-W)<1e-3)),top=fitted.find(l=>on(l,p=>Math.abs(p[1]-H)<1e-3));
 check(bottom&&right&&top,'each line lies on its flat');
 await page.$eval('[data-test=sketch-fit-back]',e=>e.click());await sleep(300);
 await page.$eval('[data-test=sketch-sharpen]',e=>e.click());await sleep(200);
 await page.$eval('[data-test=corner-mode-autoFillet]',e=>e.click());await page.$eval('[data-test=corner-add-dimension]',e=>{if(!e.checked)e.click()});await sleep(150);
 // How far each line stops from the corner points, on screen.
 const px=async(a,b)=>{const p=await screen(a),q=await screen(b);return Math.hypot(p.x-q.x,p.y-q.y)};
 const near=(l,x)=>[l.a,l.b].sort((p,q)=>Math.hypot(p[0]-x[0],p[1]-x[1])-Math.hypot(q[0]-x[0],q[1]-x[1]))[0];
 const roundCorner=[W,-H],ellipseCorner=[W,H];
 const gaps=[await px(near(bottom,roundCorner),roundCorner),await px(near(right,roundCorner),roundCorner),await px(near(right,ellipseCorner),ellipseCorner),await px(near(top,ellipseCorner),ellipseCorner)];
 record.gapsPx=gaps.map(g=>+g.toFixed(0));
 check(Math.min(...gaps)>60,`every line stops well short of its corner points on screen (${record.gapsPx.join(', ')} px; the brush is 7 px)`);
 // The R5 corner: a dab on the corner point alone.
 const start=await sketch();
 let h=await history();
 await dab(roundCorner,'02-dab-round-held');
 let s=await sketch(),msg=await message();
 const round=s.entities.find(e=>e.kind==='arc'&&e.c[1]<0);
 check(!(await page.$('[data-test=corner-accept]')),'no Accept button: the result went in at once');
 check(round&&(await history())-h===2,`a dab on the R5 corner point made a fillet in two undo steps ("${msg}")`);
 check(/Fillet created/.test(msg??''),`the panel says "${msg}"`);
 if(round){record.round={quickScan:round.r,difference:round.r-NATIVE.round};check(Math.abs(round.r-NATIVE.round)<5e-5,`R5 corner R ${round.r.toFixed(6)}, QUICKSURFACE ${NATIVE.round}`)}
 await page.screenshot({path:out+'/03-round.png'});
 // The elliptical corner, the same way.
 h=await history();
 await dab(ellipseCorner,'04-dab-ellipse-held');
 s=await sketch();msg=await message();
 const ellipse=s.entities.find(e=>e.kind==='arc'&&e.c[1]>0);
 check(ellipse&&(await history())-h===2,`a dab on the elliptical corner point made a fillet in two undo steps ("${msg}")`);
 if(ellipse){record.ellipse={quickScan:ellipse.r,difference:ellipse.r-NATIVE.ellipse};check(Math.abs(ellipse.r-NATIVE.ellipse)<5e-5,`3 × 9 corner R ${ellipse.r.toFixed(6)}, QUICKSURFACE ${NATIVE.ellipse}`)}
 check(s.constraints.filter(c=>c.kind==='tangent').length===4,'tangent at all four ends');
 const lines=s.entities.filter(e=>e.kind==='line');
 check(lines.every(l=>{const f=fitted.find(x=>x.id===l.id);return f&&(Math.abs(f.a[1]-f.b[1])<1e-9?Math.abs(l.a[1]-f.a[1])<1e-9&&Math.abs(l.b[1]-f.a[1])<1e-9:Math.abs(l.a[0]-f.a[0])<1e-9&&Math.abs(l.b[0]-f.a[0])<1e-9)}),'every line stays on its flat');
 await page.screenshot({path:out+'/05-both.png'});
 // Four undos go back to the brushed lines exactly.
 for(let i=0;i<4;i++){await page.click('[data-test=undo]');await sleep(250)}
 check(JSON.stringify(await sketch())===JSON.stringify(start),'four undos restore the brushed lines exactly');
 // The older way: a stroke from line to line over the R5 corner point.
 h=await history();
 await drag([[8,-17],[8,-5],[22,-5],[22,-17]],'06-stroke-held');
 s=await sketch();
 const stroke=s.entities.find(e=>e.kind==='arc'&&e.c[1]<0);
 check(stroke&&(await history())-h===2&&round&&Math.abs(stroke.r-round.r)<1e-9,`a stroke over the ends and the corner point reads the same radius (${stroke?.r})`);
 await page.$eval('[data-test=corner-cancel]',e=>e.click());
 check(!consoleErrors.length,'no console errors: '+consoleErrors.join(' | '));
}catch(e){console.log('FATAL',e.stack??e);results.push({ok:false,what:'FATAL '+e.message});await page.screenshot({path:out+'/failure.png'}).catch(()=>{})}
finally{fs.writeFileSync(out+'/result.json',JSON.stringify({...record,results},null,2));await browser.close()}
const failed=results.filter(r=>!r.ok);
console.log(failed.length?`FAILED ${failed.length} of ${results.length}`:`ALL PASS (${results.length})`);
process.exit(failed.length?1:0);
