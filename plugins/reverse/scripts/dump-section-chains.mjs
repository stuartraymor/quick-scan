// SPDX-License-Identifier: AGPL-3.0-only
// Dev tool: load a scan, open 2D Sketch on world planes at given offsets and
// save the slice chains (the points Auto Fillet reads) with a screenshot of
// each section. Used to build the Auto Fillet stress harness on real scans.
// Usage: node dump-section-chains.mjs <mesh> <out.json> axis:offset ...
import fs from 'node:fs';
import {launchApp,loadScan,sleep,shotPath} from '../../../scripts/e2e-lib.mjs';
import {openReverse} from './lib.mjs';
const [mesh,outFile,...planes]=process.argv.slice(2);
const out=shotPath('section-chains');fs.mkdirSync(out,{recursive:true});
const {browser,page}=await launchApp({width:1600,height:1000,protocolTimeout:900_000});
const result={mesh,sections:[]};
try{
 await loadScan(page,mesh);await openReverse(page);
 for(const spec of planes){
  const [axis,offset]=spec.split(':');
  const frame=await page.evaluate(({axis,offset})=>{
   const r=window.__re.store;r.setState({sketchDraft:null});
   const o=Number(offset),basis={x:[[0,1,0],[0,0,1],[1,0,0]],y:[[0,0,1],[1,0,0],[0,1,0]],z:[[1,0,0],[0,1,0],[0,0,1]]}[axis];
   const origin=axis==='x'?[o,0,0]:axis==='y'?[0,o,0]:[0,0,o];
   const frame={origin,basisU:basis[0],basisV:basis[1],normal:basis[2]};
   r.getState().startSketch({kind:'world',axis,offset:o},frame);return frame;
  },{axis,offset});
  await sleep(2500);
  const chains=await page.evaluate(()=>window.__re.chains()?.chains??[]);
  const all=chains.flat();const bb=all.length?[Math.min(...all.map(p=>p[0])),Math.min(...all.map(p=>p[1])),Math.max(...all.map(p=>p[0])),Math.max(...all.map(p=>p[1]))]:null;
  if(bb)await page.evaluate(b=>window.__re.sheet().zoomTo?.([b[0]-5,b[1]-5,b[2]+5,b[3]+5]),bb);await sleep(400);
  await page.screenshot({path:`${out}/${axis}${offset}.png`});
  result.sections.push({axis,offset:Number(offset),frame,bbox:bb,chains});
  console.log(spec,'chains',chains.length,'points',all.length,'bbox',bb?.map(v=>v.toFixed(1)).join(','));
 }
 fs.writeFileSync(outFile,JSON.stringify(result));
}finally{await browser.close()}
