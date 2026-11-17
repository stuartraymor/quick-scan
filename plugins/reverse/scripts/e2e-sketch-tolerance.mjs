// SPDX-License-Identifier: AGPL-3.0-only
// 2D Sketch overhaul 4 acceptance: live tolerance analysis on a scanned
// plate. A line drawn along the bottom edge climbs 0.4 mm off it over 20 mm,
// so with ±0.1 mm it passes along its first quarter and fails after; the
// colours split on the sheet, the stats read it, and changing the tolerance
// (in inches too) or moving the line's end updates it at once. Gradient
// mode shades it.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {launchApp,loadScan,sleep,shotPath,setUnits} from '../../../scripts/e2e-lib.mjs';
import {openReverse} from './lib.mjs';
const out=shotPath('sketch-tolerance');fs.mkdirSync(out,{recursive:true});
const R=5,W=20,H=15,steps=24,outline=[];
for(const [cx,cy,a0] of [[W-R,H-R,0],[-W+R,H-R,Math.PI/2],[-W+R,-H+R,Math.PI],[W-R,-H+R,3*Math.PI/2]])
 for(let i=0;i<=steps;i++){const a=a0+(Math.PI/2)*i/steps;outline.push([cx+R*Math.cos(a),cy+R*Math.sin(a)])}
const n=outline.length,mesh=[];
for(const z of [-5,5])for(const [x,y] of outline)mesh.push(`v ${x} ${y} ${z}`);
mesh.push('v 0 0 -5','v 0 0 5');
for(let i=0;i<n;i++){const a=i+1,b=(i+1)%n+1;mesh.push(`f ${a} ${b} ${b+n}`,`f ${a} ${b+n} ${a+n}`,`f ${2*n+1} ${b} ${a}`,`f ${2*n+2} ${a+n} ${b+n}`)}
const meshPath=out+'/plate.obj';fs.writeFileSync(meshPath,mesh.join('\n'));
const {browser,page,consoleErrors}=await launchApp({width:1700,height:1050});
const colours=()=>page.evaluate(()=>{const s=window.__re.sheet();const out={};s.elementGroup.traverse(o=>{const c=o.material?.color;if(c&&o.material.linewidth!==undefined){const h='#'+c.getHexString();out[h]=(out[h]??0)+1}});return out});
const text=sel=>page.$eval(sel,e=>e.textContent);
try{
 await loadScan(page,meshPath);await openReverse(page);
 const entities=[{kind:'line',a:[-10,-H],b:[10,-H+0.4]}];
 await page.evaluate(async entities=>{const r=window.__re.store;r.setState({sketchDraft:null});r.getState().startSketch({kind:'world',axis:'z',offset:0},{origin:[0,0,0],normal:[0,0,1],basisU:[1,0,0],basisV:[0,1,0]},entities);},entities);await sleep(900);
 await page.evaluate(()=>window.__re.sheet().zoomTo?.([-12,-17,12,-12]));await sleep(300);
 await page.$eval('[data-test=sketch-analysis]',e=>e.click());await sleep(300);
 const legend=await text('[data-test=sketch-analysis-legend]');assert.match(legend,/within ±0\.1000? mm/);
 const stats=await text('[data-test=sketch-analysis-stats]');const pass=await text('[data-test=sketch-analysis-pass]');
 console.log('stats',stats,'|',pass);
 assert.match(stats,/max 0\.4000 mm/);
 const share=Number(pass.match(/([\d.]+) %/)[1]);assert.ok(Math.abs(share-25)<1.5,'25 % of the line passes: '+share);
 let c=await colours();console.log('colours',JSON.stringify(c));
 assert.ok(c['#2fbf71']>=1&&c['#e5484d']>=1,'green and red portions drawn');
 await page.screenshot({path:out+'/01-pass-fail.png'});
 // Tolerance 0.3 mm: 75 % passes, immediately.
 await page.$eval('[data-test=sketch-analysis-options]',e=>e.click());await sleep(150);
 const tol=await page.$('[data-test=sketch-analysis-tolerance]');await tol.focus();await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');await page.keyboard.type('0.35');await sleep(300);
 assert.equal(await page.$eval('[data-test=sketch-analysis-tolerance]',e=>e.value),'0.35','typing keeps focus');
 await page.keyboard.press('Backspace');await sleep(300);
 const share3=Number((await text('[data-test=sketch-analysis-pass]')).match(/([\d.]+) %/)[1]);assert.ok(Math.abs(share3-75)<1.5,'75 % at 0.3 mm: '+share3);
 // Moving the line's far end onto the edge: all of it passes.
 await page.evaluate(()=>{const s=window.__re.store.getState();const sk=structuredClone(s.sketchDraft.sketch);sk.entities[0].b=[10,-15];s.setSketch(sk)});await sleep(300);
 const shareAll=Number((await text('[data-test=sketch-analysis-pass]')).match(/([\d.]+) %/)[1]);assert.equal(shareAll,100);
 c=await colours();assert.ok(!c['#e5484d'],'no red once on the edge');
 await page.evaluate(()=>window.__re.store.getState().undoSketch());await sleep(300);
 // Gradient: several shades along the climbing line.
 await page.$eval('[data-test=sketch-analysis-mode-gradient]',e=>e.click());await sleep(300);
 c=await colours();const shades=Object.keys(c).filter(h=>h!=='#000000'&&h!=='#3d8fd6');console.log('gradient',JSON.stringify(c));
 assert.ok(shades.length>=4,'gradient shades: '+shades.length);
 assert.match(await text('[data-test=sketch-analysis-legend]'),/≥ 0\.6000? mm/);
 await page.screenshot({path:out+'/02-gradient.png'});
 // Inches: the tolerance reads 0.0118 in and the geometry is unchanged.
 const before=await page.evaluate(()=>JSON.stringify(window.__re.store.getState().sketchDraft.sketch.entities));
 await page.click('[data-test="ribbon-tab-settings"]');await sleep(150);await page.click('[data-test="ribbon-inches"]');await sleep(400);
 const inches=await page.$eval('[data-test=sketch-analysis-tolerance]',e=>e.value).catch(()=>null);
 console.log('inches field',inches);assert.equal(inches,String(Number((0.3/25.4).toFixed(6))),'tolerance shown in inches');
 assert.match(await text('[data-test=sketch-analysis-legend]'),/in/);
 const shareIn=Number((await text('[data-test=sketch-analysis-pass]')).match(/([\d.]+) %/)[1]);assert.ok(Math.abs(shareIn-75)<1.5,'same result in inches');
 const after=await page.evaluate(()=>JSON.stringify(window.__re.store.getState().sketchDraft.sketch.entities));
 assert.equal(after,before,'switching units never moves geometry');
 fs.writeFileSync(out+'/result.json',JSON.stringify({passed:true,stats,share,share3,shades:shades.length,inches},null,2));
 // Off: no colours.
 await page.$eval('[data-test=sketch-analysis]',e=>e.click());await sleep(300);c=await colours();
 assert.ok(!c['#2fbf71']&&!c['#e5484d'],'analysis off clears the colours');
 assert.deepEqual(consoleErrors,[]);console.log('PASS tolerance analysis: 25 % → 75 % → 100 %, gradient',shades.length,'shades, inches field',inches);
}catch(e){await page.screenshot({path:out+'/failure.png'});console.log(await page.evaluate(()=>document.body.innerText.slice(-1500)));throw e;}finally{await browser.close()}
