// SPDX-License-Identifier: AGPL-3.0-only
// 1.2.8: Corner Trim's last fillet keeps an editable radius. On a scanned
// plate with R5 corners, the two straight edges are brushed with Fit Line by
// mouse, and Auto Fillet is swept over the corner point. Then:
//  - the panel says how far the scan points lie off the finished corner,
//    within the sketch tolerance (an R5 round: all within);
//  - typing 6 in Fillet radius rebuilds the fillet at R 6, tangent, far ends
//    kept, one undo step, and says the scan round is now outside tolerance;
//  - dragging the square handle on the arc outward previews a larger radius
//    (dashed, its value shown) and puts it in on release; Esc mid-drag
//    changes nothing;
//  - Undo steps back through the radii to the fitted R5.
// Then an elliptical (3 × 9) corner: the arc is made, as QUICKSURFACE makes
// it, and the panel says the round is not circular.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {launchApp,loadScan,sleep,shotPath} from '../../../scripts/e2e-lib.mjs';
import {openReverse} from './lib.mjs';
const out=shotPath('fillet-radius');fs.mkdirSync(out,{recursive:true});
// A 40 × 30 plate, z −5..5, corners rounded by `corner(t)`.
function plate(name,round){
 const W=20,H=15,steps=48,outline=[];
 const quads=[[W,H,0],[-W,H,Math.PI/2],[-W,-H,Math.PI],[W,-H,3*Math.PI/2]];
 // Each round, then its straight side to the next round in 0.5 mm steps, so
 // the section has points along the sides as a scan would.
 for(let q=0;q<4;q++){const [cx,cy,a0]=quads[q];for(let i=0;i<=steps;i++)outline.push(round(cx,cy,a0+(Math.PI/2)*i/steps));
  const [nx,ny,n0]=quads[(q+1)%4],from=outline[outline.length-1],to=round(nx,ny,n0),len=Math.hypot(to[0]-from[0],to[1]-from[1]),k=Math.max(1,Math.round(len/0.5));
  for(let i=1;i<k;i++)outline.push([from[0]+(to[0]-from[0])*i/k,from[1]+(to[1]-from[1])*i/k])}
 const n=outline.length,mesh=[];
 for(const z of [-5,5])for(const [x,y] of outline)mesh.push(`v ${x} ${y} ${z}`);
 mesh.push('v 0 0 -5','v 0 0 5');
 for(let i=0;i<n;i++){const a=i+1,b=(i+1)%n+1;mesh.push(`f ${a} ${b} ${b+n}`,`f ${a} ${b+n} ${a+n}`,`f ${2*n+1} ${b} ${a}`,`f ${2*n+2} ${a+n} ${b+n}`)}
 const p=`${out}/${name}.obj`;fs.writeFileSync(p,mesh.join('\n'));return p;
}
// Circle R5 inside the corner (cx, cy): centre (cx ∓ 5, cy ∓ 5).
const circular=(cx,cy,a)=>{const ox=cx-Math.sign(cx)*5,oy=cy-Math.sign(cy)*5;return [ox+5*Math.cos(a),oy+5*Math.sin(a)]};
// Ellipse 9 along x, 3 along y.
const elliptical=(cx,cy,a)=>{const ox=cx-Math.sign(cx)*9,oy=cy-Math.sign(cy)*3;return [ox+9*Math.cos(a),oy+3*Math.sin(a)]};
const {browser,page,consoleErrors}=await launchApp({width:1800,height:1100});
const read=()=>page.evaluate(()=>{const d=window.__re.store.getState().sketchDraft;return {sketch:d.sketch,history:d.history.length}});
const screen=p=>page.evaluate(p=>window.__re.sheet().sheetScreenPoint(p),p);
const drag=async(path)=>{const pts=[];for(const p of path)pts.push(await screen(p));await page.mouse.move(pts[0].x,pts[0].y);await page.mouse.down();for(const p of pts.slice(1))await page.mouse.move(p.x,p.y,{steps:8});await sleep(200);await page.mouse.up();await sleep(600)};
const text=sel=>page.$eval(sel,e=>e.textContent).catch(()=>null);
const arcOf=s=>s.entities.find(e=>e.kind==='arc');
const tangentGap=(s,arc)=>{const ends=[0,1].map(k=>{const a=arc.start+k*arc.sweep;return [arc.c[0]+arc.r*Math.cos(a),arc.c[1]+arc.r*Math.sin(a)]});let worst=0;for(const l of s.entities.filter(e=>e.kind==='line')){const dx=l.b[0]-l.a[0],dy=l.b[1]-l.a[1];const off=Math.abs(Math.abs((arc.c[0]-l.a[0])*dy-(arc.c[1]-l.a[1])*dx)/Math.hypot(dx,dy)-arc.r);const gap=Math.min(...[l.a,l.b].flatMap(p=>ends.map(e=>Math.hypot(e[0]-p[0],e[1]-p[1]))));worst=Math.max(worst,off,gap)}return worst};
const result={};
async function brushCorner(meshPath,stopX,stopY){
 await loadScan(page,meshPath);await openReverse(page);
 if(await page.$('[data-test=support-card] .sc-x'))await page.$eval('[data-test=support-card] .sc-x',e=>e.click());
 await page.evaluate(()=>{const r=window.__re.store;r.setState({sketchDraft:null});r.getState().startSketchOn({kind:'world',axis:'z',offset:0})});
 await page.waitForSelector('[data-test=sketch-extract]');await sleep(2500);
 await page.evaluate(()=>window.__re.sheet().zoomTo?.([0,-20,26,2]));await sleep(300);
 // Fit Line on the bottom edge (y = −15) and the right edge (x = 20), by mouse.
 await page.$eval('[data-test=sketch-extract]',e=>e.click());
 await page.waitForSelector('[data-test=sketch-fit-brush-overlay]');await sleep(300);
 await page.$eval('[data-test=sketch-fit-line]',e=>e.click());await sleep(150);
 await drag(Array.from({length:11},(_,i)=>[2+(stopX-2)*i/10,-15]));
 await drag(Array.from({length:11},(_,i)=>[20,0+(stopY-0)*i/10]));
 const fitted=await read();
 assert.equal(fitted.sketch.entities.filter(e=>e.kind==='line').length,2,'two lines brushed: '+JSON.stringify(fitted.sketch.entities.map(e=>e.kind)));
 assert.ok(fitted.sketch.entities.every(e=>e.points?.length>=2),'both lines keep their section points');
 await page.$eval('[data-test=sketch-fit-back]',e=>e.click());await sleep(300);
 await page.$eval('[data-test=sketch-sharpen]',e=>e.click());await sleep(200);
 await page.$eval('[data-test=corner-mode-autoFillet]',e=>e.click());await sleep(150);
 // Sweep: bottom line's end, over the corner point (20, −15), right line's end.
 const lines=fitted.sketch.entities;
 const nearOf=l=>[l.a,l.b].sort((p,q)=>Math.hypot(p[0]-20,p[1]+15)-Math.hypot(q[0]-20,q[1]+15))[0];
 await drag([nearOf(lines[0]),[20.4,-15.4],nearOf(lines[1])]);
 const accept=await page.$('[data-test=corner-accept]');if(accept){await accept.click();await sleep(400)}
 return fitted;
}
try{
 // ---- R5 round
 const fitted=await brushCorner(plate('rounded-plate',circular),13,-8);
 let now=await read();const arc5=arcOf(now.sketch);
 assert.ok(arc5,'Auto Fillet made an arc: '+await text('[data-test=corner-message]'));
 assert.ok(Math.abs(arc5.r-5)<0.02,'fitted R '+arc5.r);
 const fit5=await page.$eval('[data-test=corner-scan-fit]',e=>({t:e.textContent,x:e.dataset.exceeds}));
 assert.equal(fit5.x,'0','R5 within tolerance: '+fit5.t);
 const field=await page.$eval('[data-test=corner-fillet-radius]',e=>e.value);assert.ok(Math.abs(parseFloat(field)-arc5.r)<1e-3,'radius field shows the fillet: '+field);
 await page.screenshot({path:out+'/01-auto-r5.png'});
 result.auto={r:arc5.r,scanFit:fit5.t};
 const farOf=l=>[l.a,l.b].sort((p,q)=>Math.hypot(q[0]-20,q[1]+15)-Math.hypot(p[0]-20,p[1]+15))[0];
 const far=fitted.sketch.entities.map(farOf);
 const farKept=s=>far.every(f=>s.entities.some(e=>e.kind==='line'&&[e.a,e.b].some(p=>Math.hypot(p[0]-f[0],p[1]-f[1])<1e-9)));
 // ---- typed radius
 const h0=now.history;
 const input=await page.$('[data-test=corner-fillet-radius]');await input.focus();await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');await page.keyboard.type('6');
 const typedValue=await page.$eval('[data-test=corner-fillet-radius]',e=>e.value);
 await page.keyboard.press('Enter');await sleep(400);
 now=await read();const arc6=arcOf(now.sketch);
 assert.ok(Math.abs(arc6.r-6)<1e-9,`typed R6: field ${typedValue}, arc ${arc6.r}, R5 ${arc5.r}, steps ${now.history-h0}, msg ${await text('[data-test=corner-message]')}`);
 assert.equal(now.history,h0+1,'one undo step');
 assert.ok(tangentGap(now.sketch,arc6)<1e-6,'R6 tangent, no gaps');
 assert.ok(farKept(now.sketch),'far ends kept at R6');
 const fit6=await page.$eval('[data-test=corner-scan-fit]',e=>({t:e.textContent,x:e.dataset.exceeds}));
 assert.equal(fit6.x,'1','R6 against an R5 scan round is outside tolerance: '+fit6.t);
 await page.screenshot({path:out+'/02-typed-r6.png'});
 result.typed={r:arc6.r,scanFit:fit6.t};
 // ---- handle drag: Esc first, then a real drag
 const mid=a=>{const m=a.start+a.sweep/2;return [a.c[0]+a.r*Math.cos(m),a.c[1]+a.r*Math.sin(m)]};
 const m6=await screen(mid(arc6)),corner=await screen([20,-15]);
 const outward={x:m6.x+(m6.x-corner.x)*0.6,y:m6.y+(m6.y-corner.y)*0.6};
 await page.mouse.move(m6.x,m6.y);await sleep(120);await page.mouse.down();await page.mouse.move(outward.x,outward.y,{steps:6});await sleep(250);
 const previewing=await page.evaluate(()=>window.__re.cornerTrim?.getState?.().radiusPreview?.radiusMm??null);
 await page.screenshot({path:out+'/03-handle-held.png'});
 await page.keyboard.press('Escape');await sleep(150);await page.mouse.up();await sleep(300);
 now=await read();assert.ok(Math.abs(arcOf(now.sketch).r-6)<1e-12&&now.history===h0+1,'Esc mid-drag changed nothing');
 await page.mouse.move(m6.x,m6.y);await sleep(120);await page.mouse.down();await page.mouse.move(outward.x,outward.y,{steps:6});await sleep(250);await page.mouse.up();await sleep(500);
 now=await read();const arcD=arcOf(now.sketch);
 assert.ok(arcD.r>6.5,'dragged outward: R '+arcD.r);
 assert.ok(Math.abs(arcD.r*100-Math.round(arcD.r*100))<1e-6,'dragged radius lands on 0.01 mm: '+arcD.r);
 assert.equal(now.history,h0+2,'the drag is one undo step');
 assert.ok(tangentGap(now.sketch,arcD)<1e-6&&farKept(now.sketch),'dragged fillet tangent, far ends kept');
 await page.screenshot({path:out+'/04-dragged.png'});
 result.drag={previewing,r:arcD.r};
 // ---- Undo back to the fitted R5 (two radius steps)
 await page.evaluate(()=>{const s=window.__re.store.getState();s.undoSketch();s.undoSketch()});await sleep(300);
 now=await read();assert.ok(Math.abs(arcOf(now.sketch).r-arc5.r)<1e-12,'two Undos restore the fitted R5');
 await page.$eval('[data-test=corner-cancel]',e=>e.click());await sleep(200);
 // ---- elliptical corner
 await brushCorner(plate('elliptical-plate',elliptical),9,-10);
 now=await read();const arcE=arcOf(now.sketch);
 assert.ok(arcE,'an arc is made on the elliptical corner');
 const fitE=await page.$eval('[data-test=corner-scan-fit]',e=>({t:e.textContent,x:e.dataset.exceeds}));
 const msgE=await text('[data-test=corner-message]');
 assert.equal(fitE.x,'1','elliptical round outside tolerance: '+fitE.t);
 assert.match(msgE,/not circular/);
 await page.screenshot({path:out+'/05-elliptical.png'});
 result.elliptical={r:arcE.r,scanFit:fitE.t,message:msgE};
 assert.deepEqual(consoleErrors,[]);
 fs.writeFileSync(out+'/result.json',JSON.stringify({passed:true,...result},null,2));
 console.log('PASS fillet radius:',JSON.stringify(result));
}catch(e){await page.screenshot({path:out+'/failure.png'});console.log(await page.evaluate(()=>document.body.innerText.slice(-1500)));throw e;}finally{await browser.close()}
