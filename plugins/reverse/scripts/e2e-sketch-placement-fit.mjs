// SPDX-License-Identifier: AGPL-3.0-only
import {writeFileSync,readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {launchApp,loadScan,click,check,finish,shotPath,sleep} from '../../../scripts/e2e-lib.mjs'
import {openReverse,reverseHelpers} from './lib.mjs'
const n=160,obj=[]
for(const z of [-5,5])for(let i=0;i<n;i++)obj.push(`v ${10*Math.cos(i*Math.PI*2/n)} ${10*Math.sin(i*Math.PI*2/n)} ${z}`)
obj.push('v 0 0 -5','v 0 0 5')
for(let i=0;i<n;i++){const a=i+1,b=(i+1)%n+1,c=a+n,d=b+n;obj.push(`f ${a} ${b} ${d}`,`f ${a} ${d} ${c}`,`f ${2*n+1} ${b} ${a}`,`f ${2*n+2} ${c} ${d}`)}
const fixture=shotPath('workflow-cylinder-r10.obj');writeFileSync(fixture,obj.join('\n'))
check(createHash('sha256').update(readFileSync(fixture)).digest('hex')==='705a33aed997598451bdab9418796811baaf5dbf3ed75389f02f7bffb6fb04cc','same native comparison mesh bytes')

const {browser,page,consoleErrors}=await launchApp({width:1500,height:960})
const {re}=reverseHelpers(page)
try {
 await loadScan(page,fixture);await openReverse(page)
 await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Main').click())
 await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='2D Sketch').click())
 await page.waitForSelector('[data-test=place-create]');await sleep(400)
 const placement=()=>re(()=>{const s=window.__re.reScene(),a=s.sliceArrow,h=s.host;return {origin:a.spec.origin,offset:a.spec.offset,clipped:!!h.clipPlanes(),lengthPx:a.sprite.scale.y/((h.camera().top-h.camera().bottom)/h.camera().zoom/h.canvas.getBoundingClientRect().height),arrow:a.screenAxis(),base:s.bodyPicks.screenProjection()(...a.spec.origin)}})
 const planeCases=[]
 for(const [axis,index] of [['x',0],['y',1],['z',2]]) {
  await click(page,'[data-test=place-plane-'+axis+']')
  for(const offset of [20,-2,0]) {
   await page.$eval('[data-test=place-offset]',(e,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,String(value));e.dispatchEvent(new Event('input',{bubbles:true}))},offset)
   await click(page,'[data-test=place-offset-apply]');await sleep(80)
   const state=await placement();check(!state.clipped&&Math.abs(state.origin[index]-offset)<1e-8,axis+' plane at '+offset+': complete scan and correctly positioned handle')
   planeCases.push({axis,offset,state})
  }
 }
 const before=await placement();check(!before.clipped,'placement keeps the complete scan visible');check(before.origin.every(v=>Math.abs(v)<1e-10),'arrow is centered on the scan section');check(Math.abs(before.lengthPx-32)<.01,'arrow is32CSS pixels high')
 await page.mouse.move(before.base[0]+80,before.base[1]+80);await page.mouse.wheel({deltaY:-240});await sleep(300)
 const zoomed=await placement();check(Math.abs(zoomed.lengthPx-before.lengthPx)<.01,'zoom keeps the same screen-sized arrow')
 const axis=zoomed.arrow,n=Math.hypot(axis.x,axis.y),dx=n>=4?axis.x/n:0,dy=n>=4?axis.y/n:-1
 const start={x:zoomed.base[0]+dx*15,y:zoomed.base[1]+dy*15}
 await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x+dx*45,start.y+dy*45,{steps:12});await sleep(150)
 const during=await placement();check(during.offset>0,'drag moves plane along its normal while held');check(!during.clipped,'drag does not clip the scan');check(Math.abs(during.origin[2]-during.offset)<1e-8,'arrow follows the moving plane')
 await page.mouse.up();await sleep(100);check(Math.abs((await placement()).offset-during.offset)<1e-8,'release retains the offset')
 await page.screenshot({path:shotPath('placement-centered-sheet.png')})
 await page.$eval('[data-test=place-offset]',e=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'0');e.dispatchEvent(new Event('input',{bubbles:true}))});await click(page,'[data-test=place-offset-apply]');await click(page,'[data-test=place-create]');await page.waitForSelector('[data-test=sketch-editor]');await sleep(400)
 await click(page,'[data-test=sketch-extract]');await re(async()=>{window.__brush=(await import('/plugins/reverse/state/sketchBrushStore.ts')).useSketchBrush})
 const results=[]
 for(const primitive of ['circle','arc','line']) {
  await re(p=>{window.__brush.getState().setPrimitive(p);window.__brush.getState().setInstant(true)},primitive)
  const points=await re(()=>Array.from({length:21},(_,i)=>window.__re.sheet().sheetScreenPoint([10*Math.cos(i*Math.PI/40),10*Math.sin(i*Math.PI/40)])))
  const count=await re(()=>window.__re.store.getState().sketchDraft.sketch.entities.length)
  await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();for(const p of points.slice(1))await page.mouse.move(p.x,p.y);await sleep(120)
  const held=await re(()=>{const c=document.querySelector('[data-test=sketch-fit-brush-overlay]'),data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let green=0,orange=0;for(let i=0;i<data.length;i+=4){if(data[i+3]>200&&data[i]<20&&data[i+1]>130&&data[i+1]<180&&data[i+2]>40&&data[i+2]<100)green++;if(data[i+3]>200&&data[i]>240&&data[i+1]>130&&data[i+1]<180&&data[i+2]<30)orange++}return {green,orange,selected:window.__brush.getState().selected.length,entities:window.__re.store.getState().sketchDraft.sketch.entities.length}})
  check(held.entities===count&&held.selected>10&&held.orange>20&&held.green===0,primitive+': only reference points highlighted while held, no curve or committed entity')
  await page.screenshot({path:shotPath('fit-'+primitive+'-held.png')});await page.mouse.up();await sleep(150)
  const after=await re(()=>window.__re.store.getState().sketchDraft.sketch.entities)
  check(after.length===count+1&&after.at(-1).kind===primitive,primitive+': release creates exactly one entity')
  await re(()=>window.__re.store.getState().undoSketch());check(await re(()=>window.__re.store.getState().sketchDraft.sketch.entities.length)===count,primitive+': one sketch undo removes the fit')
  results.push({primitive,held,after:after.at(-1)})
 }
 await page.keyboard.press('Escape');check(!(await page.$('[data-test=sketch-fit-brush-overlay]')),'Escape releases fitting overlay');check(await re(()=>document.documentElement.dataset.theme)==='dark','dark theme remains active')
 writeFileSync(shotPath('placement-fit.json'),JSON.stringify({fixtureSHA256:createHash('sha256').update(readFileSync(fixture)).digest('hex'),planeCases,before,zoomed,during,results},null,2))
} finally {await finish(browser,consoleErrors)}
