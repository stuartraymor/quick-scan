// SPDX-License-Identifier: AGPL-3.0-only
// Auto Fillet on a real scan in the GUI. QUICKSURFACE's example basic_part
// scan is sliced at the planes of the Auto Fillet stress test
// (tests/reAutoFilletStress.test.ts); at each listed corner the two lines
// Fit Line made there are put in the sketch and the corner is swept in
// Corner Trim's Auto Fillet over both line ends and the corner point. The
// GUI must make the same round as the stress test read off the same section,
// tangent to both lines, in two undo steps. These corners include lines
// short of the corner and far from it, which 1.2.5 left sharp or refused.
// Usage: node e2e-sketch-autofillet-realscan.mjs [basic_part.stl] [gui-cases.json]
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {launchApp,loadScan,sleep,shotPath} from '../../../scripts/e2e-lib.mjs';
import {openReverse} from './lib.mjs';
const mesh=process.argv[2]??'C:/Users/stuar/Code/QUICKSCAN/test-models/basic_part/basic_part.stl';
const casesFile=process.argv[3]??'analysis/autofillet/basic_part-gui-cases.json';
if(!fs.existsSync(mesh)||!fs.existsSync(casesFile)){console.log('SKIP autofillet realscan: scan or cases missing (run tests/reAutoFilletStress.test.ts first)');process.exit(0)}
const cases=JSON.parse(fs.readFileSync(casesFile,'utf8'));
const out=shotPath('autofillet-realscan');fs.mkdirSync(out,{recursive:true});
const bases={x:[[0,1,0],[0,0,1],[1,0,0]],y:[[0,0,1],[1,0,0],[0,1,0]],z:[[1,0,0],[0,1,0],[0,0,1]]};
const {browser,page,consoleErrors}=await launchApp({width:1800,height:1100});
const read=()=>page.evaluate(()=>window.__re.store.getState().sketchDraft.sketch);
const history=()=>page.evaluate(()=>window.__re.store.getState().sketchDraft.history.length);
const screen=p=>page.evaluate(p=>window.__re.sheet().sheetScreenPoint(p),p);
const results=[];
try{
 await loadScan(page,mesh);await openReverse(page);
 for(const c of cases){
  const axis=c.section[0],offset=Number(c.section.slice(1)),basis=bases[axis];
  const origin=axis==='x'?[offset,0,0]:axis==='y'?[0,offset,0]:[0,0,offset];
  await page.evaluate(({frame,lines,axis,offset})=>{const r=window.__re.store;r.setState({sketchDraft:null});r.getState().startSketch({kind:'world',axis,offset},frame,lines.map(([a,b])=>({kind:'line',a,b})));},{frame:{origin,basisU:basis[0],basisV:basis[1],normal:basis[2]},lines:[c.la,c.lb],axis,offset});
  await sleep(2500);
  const xs=[...c.path,...c.la,...c.lb].map(p=>p[0]),ys=[...c.path,...c.la,...c.lb].map(p=>p[1]);
  const cx=(Math.min(...c.path.map(p=>p[0]))+Math.max(...c.path.map(p=>p[0])))/2,cy=(Math.min(...c.path.map(p=>p[1]))+Math.max(...c.path.map(p=>p[1])))/2;
  const span=Math.max(6,Math.max(...c.path.map(p=>p[0]))-Math.min(...c.path.map(p=>p[0])),Math.max(...c.path.map(p=>p[1]))-Math.min(...c.path.map(p=>p[1])))*1.6;
  void xs;void ys;
  await page.evaluate(b=>window.__re.sheet().zoomTo?.(b),[cx-span/2,cy-span/2,cx+span/2,cy+span/2]);await sleep(400);
  await page.$eval('[data-test=sketch-sharpen]',e=>e.click());await sleep(200);
  await page.$eval('[data-test=corner-mode-autoFillet]',e=>e.click());await page.$eval('[data-test=corner-add-dimension]',e=>{if(!e.checked)e.click()});await sleep(150);
  const h=await history(),start=await read();
  const pts=[];for(const p of c.path)pts.push(await screen(p));
  await page.mouse.move(pts[0].x,pts[0].y);await page.mouse.down();for(const p of pts.slice(1))await page.mouse.move(p.x,p.y,{steps:12});await sleep(250);
  const tag=c.id.replace(/[^\w]+/g,'_');
  await page.screenshot({path:`${out}/${tag}-held.png`});await page.mouse.up();await sleep(700);
  const s=await read(),arc=s.entities.find(e=>e.kind==='arc');
  const msg=await page.$eval('[data-test=corner-message]',e=>e.textContent).catch(()=>null);
  const confirm=await page.$('[data-test=corner-accept]');
  if(!arc&&confirm){await confirm.click();await sleep(400)}
  const s2=await read(),arc2=s2.entities.find(e=>e.kind==='arc');
  await page.screenshot({path:`${out}/${tag}.png`});
  const row={id:c.id,expected:c.radius,quickScan:arc2?.r??null,message:msg};results.push(row);
  assert.ok(arc2,`${c.id}: no fillet — ${msg}`);
  assert.ok(Math.abs(arc2.r-c.radius)<1e-6,`${c.id}: GUI R ${arc2.r} vs core R ${c.radius}`);
  assert.equal(s2.constraints.filter(k=>k.kind==='tangent'&&(k.a===arc2.id||k.b===arc2.id)).length,2,`${c.id}: tangent to both lines`);
  assert.equal(await history(),h+2,`${c.id}: join, then fillet`);
  await page.click('[data-test=undo]');await sleep(250);await page.click('[data-test=undo]');await sleep(250);
  assert.deepEqual(await read(),start,`${c.id}: two undos restore the lines`);
  await page.click('[data-test=corner-cancel]').catch(()=>{});await sleep(200);
 }
 fs.writeFileSync(out+'/result.json',JSON.stringify(results,null,2));
 assert.deepEqual(consoleErrors,[]);console.log('PASS autofillet realscan:',results.map(r=>`${r.id} R ${r.quickScan?.toFixed(4)}`).join('; '));
}catch(e){await page.screenshot({path:out+'/failure.png'});fs.writeFileSync(out+'/result.json',JSON.stringify(results,null,2));console.log(await page.evaluate(()=>document.body.innerText.slice(-800)));throw e;}finally{await browser.close()}
