// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {launchApp,loadScan,sleep,shotPath} from '../../../scripts/e2e-lib.mjs';
import {openReverse} from './lib.mjs';
const out=shotPath('corner-paint');fs.mkdirSync(out,{recursive:true});
// Paired DXF observations: analysis/quick-scan-v0.0.191, native 8.0.128. Geometry is our cylinder fixture.
const data={"native-angle60":[{"kind":"line","a":[11.87700843811,0.0],"b":[14.81160259247,0.0]},{"kind":"line","a":[11.87700843811,5.74547624588],"b":[11.87700843811,0.0]},{"kind":"line","a":[13.34430523631,-7.460196099026],"b":[22.14808737966,-3.64522381316]},{"kind":"line","a":[13.34430523631,-7.460196099026],"b":[16.27889959366,-1.591008505973]}],"native-corner-far-joined":[{"kind":"line","a":[11.87700843811,0.0],"b":[14.81160259247,0.0]},{"kind":"line","a":[11.87700843811,5.74547624588],"b":[11.87700843811,0.0]}],"native-corner-joined":[{"kind":"line","a":[3.073226928711,0.0],"b":[11.87700843811,0.0]},{"kind":"line","a":[11.87700843811,0.0],"b":[11.87700843811,-5.99289894104]}],"native-cross-before":[{"kind":"line","a":[3.073226928711,-1.387778780781e-17],"b":[14.81160259247,-1.387778780781e-17]},{"kind":"line","a":[11.87700843811,5.74547624588],"b":[11.87700843811,-5.99289894104]}]};
const mesh=[];for(const z of [-5,5])for(let i=0;i<160;i++){const a=i*Math.PI/80;mesh.push(`v ${10*Math.cos(a)} ${10*Math.sin(a)} ${z}`)}
mesh.push('v 0 0 -5','v 0 0 5');for(let i=0;i<160;i++){const a=i+1,b=(i+1)%160+1;mesh.push(`f ${a} ${b} ${b+160}`,`f ${a} ${b+160} ${a+160}`,`f 321 ${b} ${a}`,`f 322 ${a+160} ${b+160}`)}
const meshPath=out+'/cylinder.obj';fs.writeFileSync(meshPath,mesh.join('\n'));

const {browser,page,consoleErrors}=await launchApp({width:1800,height:1100});
const read=()=>page.evaluate(()=>{const d=window.__re.store.getState().sketchDraft;return {sketch:d.sketch,history:d.history.length,error:d.error}});
const seed=async entities=>{await page.evaluate(async entities=>{const r=window.__re.store; (await import('/plugins/reverse/state/sketchCornerTrimStore.ts')).useSketchCornerTrim.getState().cancel();r.setState({sketchDraft:null});r.getState().startSketch({kind:'world',axis:'z',offset:0},{origin:[0,0,0],normal:[0,0,1],basisU:[1,0,0],basisV:[0,1,0]},entities);},entities);await sleep(600)};
const click=async s=>page.$eval(s,e=>e.click());
try{
 await loadScan(page,meshPath);await openReverse(page);
 const equalLines=(actual,expected)=>actual.every((e,i)=>['a','b'].every(k=>e[k].every((v,j)=>Math.abs(v-expected[i][k][j])<1e-8)));
 const results={};
 for(const choice of ['near','far']){
  await seed(data['native-cross-before']);console.log('choice',choice);const before=await read();await page.waitForSelector('[data-test=sketch-sharpen]',{timeout:5000});await click('[data-test=sketch-sharpen]');await sleep(200);
  const world=choice==='near'?[data['native-cross-before'][0].b,data['native-cross-before'][1].a]:[data['native-cross-before'][0].a,data['native-cross-before'][1].b];
  const ends=await page.evaluate(q=>q.map(p=>window.__re.sheet().sheetScreenPoint(p)),world);
  await page.mouse.move(ends[0].x,ends[0].y);await page.mouse.down();await page.mouse.move(ends[1].x,ends[1].y,{steps:20});assert.deepEqual((await read()).sketch,before.sketch);await page.screenshot({path:out+'/quick-'+choice+'-held.png'});await page.mouse.up();await sleep(200);
  const after=await read();assert.ok(equalLines(after.sketch.entities,data[choice==='near'?'native-corner-joined':'native-corner-far-joined']));assert.equal(after.history,1);await page.screenshot({path:out+'/quick-'+choice+'-release.png'});
  await click('[data-test=undo]');assert.deepEqual((await read()).sketch,before.sketch);await click('[data-test=redo]');assert.deepEqual((await read()).sketch,after.sketch);results[choice]=after;
 }
 await seed(data['native-cross-before']);await click('[data-test=sketch-join]');const joined=await read();assert.ok(equalLines(joined.sketch.entities,data['native-corner-joined']));await click('[data-test=sketch-join]');assert.deepEqual(await read(),joined);results.autoJoin=joined;
 await seed(data['native-angle60'].slice(-2));
 const original=await read();await click('[data-test=sketch-dimension]');
 const mids=original.sketch.entities.map(e=>[(e.a[0]+e.b[0])/2,(e.a[1]+e.b[1])/2]);
 for(const p of mids){const q=await page.evaluate(p=>window.__re.sheet().sheetScreenPoint(p),p);await page.mouse.click(q.x,q.y);}
 const place=await page.evaluate(()=>window.__re.sheet().sheetScreenPoint([17,-4]));await page.mouse.click(place.x,place.y);await page.waitForSelector('[data-test^="flat-dimension-"] input');
 const input=await page.$('[data-test^="flat-dimension-"] input');await input.click();await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');await page.keyboard.type('60');await page.keyboard.press('Enter');await sleep(400);
 const angleState=await read(),lines=angleState.sketch.entities;
 const d=lines.map(e=>[e.b[0]-e.a[0],e.b[1]-e.a[1]]);const measured=Math.acos((d[0][0]*d[1][0]+d[0][1]*d[1][1])/(Math.hypot(...d[0])*Math.hypot(...d[1])))*180/Math.PI;
 assert.ok(Math.abs(measured-60.000000004076156)<1e-5);assert.ok(angleState.sketch.constraints.some(c=>c.kind==='angle'&&Math.abs(c.value-60)<1e-8));await page.screenshot({path:out+'/quick-angle60.png'});results.angle={measured,native:60.000000004076156,state:angleState};
 await click('[data-test=undo]');const undone=await read();assert.ok(undone.sketch.constraints.some(c=>c.kind==='angle'&&Math.abs(c.value-40.006252)<1e-4));
 fs.writeFileSync(out+'/paired-comparison.json',JSON.stringify({passed:true,...results},null,2));assert.deepEqual(consoleErrors,[]);console.log('PASS native near/far endpoint geometry, Auto Join repeat, angle60 UI/geometry/undo');
}catch(e){await page.screenshot({path:out+'/paired-failure.png'});console.log(await page.evaluate(()=>document.body.innerText.slice(-3500)));throw e;}finally{await browser.close()}
