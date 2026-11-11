// SPDX-License-Identifier: AGPL-3.0-only
// Controlled datum geometry independently measured in native QSF outputs.
// UI selections, live preview, applied vertices, Undo/Redo and Save/reopen.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { launchApp, loadScan, sleep, shotPath } from './e2e-lib.mjs'
const rad=d=>d*Math.PI/180, c=Math.cos(rad(5)),s=Math.sin(rad(5))
const plane=(center,normal,basisU=[1,0,0])=>({kind:'plane',center,normal,basisU,basisV:[normal[1]*basisU[2]-normal[2]*basisU[1],normal[2]*basisU[0]-normal[0]*basisU[2],normal[0]*basisU[1]-normal[1]*basisU[0]],extentU:35,extentV:35,sigma:0,usedPoints:0,regionSize:0})
const fits=[{...plane([10,20,5],[0,0,1]),datum:{origin:[10,20,5],u:[1,0,0],frontU:[1,0,0]}},plane([10,7-20*Math.tan(rad(3)),25],[0,Math.cos(rad(3)),Math.sin(rad(3))]),plane([3-15*Math.tan(rad(5)),8,20],[c,0,s],[0,1,0]),{kind:'cylinder',center:[10,20,10],axis:[0,0,1],radius:5,length:40,coverage:360,sigma:0,usedPoints:0,regionSize:0},{kind:'cylinder',center:[10+20*c,20,5+20*s],axis:[c,0,s],radius:5,length:20,coverage:360,sigma:0,usedPoints:0,regionSize:0}]
const I=[1,0,0,0,1,0,0,0,1], apply=(r,t,p)=>[0,1,2].map(i=>r[i*3]*p[0]+r[i*3+1]*p[1]+r[i*3+2]*p[2]+t[i])
const cases=[{name:'two-planes',p:1,q:2,axis:'front',t:[-10,-7,-5]},{name:'three-planes',p:1,q:2,o:3,axis:'front',t:[-3,-7,-5]},{name:'cylinder-primary',p:4,t:[-10,-20,-10]},{name:'cylinder-cap',p:4,q:1,axis:'top',t:[-10,-20,-5]},{name:'plane-cylinder-plane',p:1,q:5,o:3,axis:'x axis',t:[-3,-20,-5]},{name:'plane-plane-cylinder',p:1,q:2,o:5,axis:'front',t:[-10,-7,-5]},{name:'right-flipped',p:1,q:2,o:3,primary:'right',flip:true,axis:'top',r:[0,0,-1,-1,0,0,0,1,0],t:[5,3,-7]}]
function box(offset=0) {const v=[[0,0,-100],[60,0,-100],[60,40,-100],[0,40,-100],[0,0,-80],[60,0,-80],[60,40,-80],[0,40,-80]].map(p=>[p[0]+offset,p[1],p[2]]);return {v,f:[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]]}}
function writeMesh(name,parts){let n=0;const lines=[];for(const {v,f} of parts){lines.push(...v.map(p=>'v '+p.join(' ')),...f.map(f=>'f '+f.map(x=>x+n+1).join(' ')));n+=v.length}const file=shotPath(name);fs.writeFileSync(file,lines.join('\n'));return file}
const one=process.env.ALIGN_MESH??writeMesh('alignment-part.obj',[box()]),two=process.env.ALIGN_ASSEMBLY??writeMesh('alignment-two-parts.obj',[box(),box(250)])
const runs=[...cases.map(c=>({...c,file:one})),{...cases[1],name:'two-part-assembly',file:two,save:true}]
if(process.env.ALIGN_SECOND_PART)runs.push({...cases[1],name:'second-part',file:process.env.ALIGN_SECOND_PART})
const {browser,page,consoleErrors}=await launchApp({width:1600,height:1100,protocolTimeout:180000})
page.on('dialog',d=>d.accept())
try {
 const results=[]
 for(const test of runs){
  await page.reload({waitUntil:'networkidle0'});await loadScan(page,test.file)
  await page.evaluate(async fits=>{const {useStore}=await import('/src/state/store.ts');useStore.setState({elements:fits.map((fit,i)=>({id:i+1,kind:fit.kind,name:fit.kind==='plane'?`Plane(${i+1})`:`Cylinder(${i-2})`,color:'#55aaff',source:{type:'picked'},status:'done',visible:true,fit}))});},fits)
  await page.click('[data-test=align-menu] summary');await page.click('[data-test=align-menu] button');await page.waitForSelector('[data-test=align-primary]',{visible:true});await page.select('[data-test=align-primary]',String(test.p));
  if(test.primary)await page.click(`[data-test=align-tile-${test.primary}]`)
  if(test.flip)await page.click('[data-test=align-primary-flip]')
  if(test.q){await page.select('[data-test=align-secondary]',String(test.q));await page.click(`[data-test="align-secondary-${test.axis}"]`)}
  if(test.o)await page.select('[data-test=align-origin]',String(test.o))
  const before=await page.evaluate(async()=>{const {useStore,alignmentPreview,alignCenterOf}=await import('/src/state/store.ts');const st=useStore.getState(),p=alignmentPreview(st.alignDraft,st.elements,st.modelSize,alignCenterOf(st));const a=window.__scanruler.scene().marking.ctx.mesh().geometry.getAttribute('position').array;return {error:p.error,r:[...p.preview.rigid.r],t:[...p.preview.rigid.t],vertices:Array.from(a),applied:st.appliedAlignment}})
  assert.equal(before.error,null);assert.equal(before.applied,null)
  for(let i=0;i<3;i++)assert.ok(Math.abs(before.t[i]-test.t[i])<1e-8,`${test.name} translation ${i}: ${before.t}`)
  for(let i=0;i<9;i++)assert.ok(Math.abs(before.r[i]-(test.r??I)[i])<1e-8,`${test.name} rotation`)
  await page.screenshot({path:shotPath(test.name+'-preview.png')})
  await page.click('[data-test=apply-alignment]');await page.waitForFunction(()=>document.body.innerText.includes('Part aligned'))
  await page.click('[data-test=cancel-alignment]');await sleep(250)
  const state=()=>page.evaluate(async()=>{const st=(await import('/src/state/store.ts')).useStore.getState();const a=window.__scanruler.scene().marking.ctx.mesh().geometry.getAttribute('position').array;return {vertices:Array.from(a),centers:st.elements.map(e=>e.fit.center),applied:st.appliedAlignment?{r:[...st.appliedAlignment.r],t:[...st.appliedAlignment.t]}:null,dark:document.documentElement.dataset.theme==='dark'}})
  const after=await state();assert.ok(after.dark);let max=0;for(let i=0;i<before.vertices.length;i+=3){const exp=apply(test.r??I,test.t,before.vertices.slice(i,i+3));for(let k=0;k<3;k++)max=Math.max(max,Math.abs(after.vertices[i+k]-exp[k]))}assert.ok(max<0.0001,`${test.name} vertex error ${max}`)
  for(let i=0;i<fits.length;i++){const exp=apply(test.r??I,test.t,fits[i].center);for(let k=0;k<3;k++)assert.ok(Math.abs(after.centers[i][k]-exp[k])<1e-8)}
  await page.screenshot({path:shotPath(test.name+'-applied.png')})
  await page.evaluate(async()=>{(await import('/src/state/historyStore.ts')).undo()});await sleep(400);assert.equal((await state()).applied,null)
  await page.evaluate(async()=>{(await import('/src/state/historyStore.ts')).redo()});await sleep(600);assert.deepEqual((await state()).applied,after.applied)
  if(test.save){await page.evaluate(()=>{const old=URL.createObjectURL;URL.createObjectURL=b=>{window.__saved=b;return old(b)};HTMLAnchorElement.prototype.click=function(){}});await page.click('[data-test=save-project]');await page.waitForFunction(()=>window.__saved instanceof Blob);const bytes=await page.evaluate(async()=>[...new Uint8Array(await window.__saved.arrayBuffer())]);const saved=shotPath('aligned-assembly.scanruler');fs.writeFileSync(saved,Buffer.from(bytes));await page.reload({waitUntil:'networkidle0'});await(await page.$('[data-test=project-input]')).uploadFile(saved);await page.waitForFunction(()=>document.body.innerText.includes('Project opened'));await sleep(500);const reopened=await state();assert.deepEqual(reopened.centers,after.centers);assert.deepEqual(reopened.applied,after.applied);assert.equal(reopened.vertices.length,after.vertices.length);for(let i=0;i<after.vertices.length;i++)assert.ok(Math.abs(reopened.vertices[i]-after.vertices[i])<0.0001);assert.ok(reopened.dark)}
  results.push({name:test.name,maxVertexErrorMm:max,preview:before.t,applied:after.applied,undoRedo:true,saveReopen:!!test.save});console.log('PASS',test.name,'preview/applied mesh + primitives, undo/redo',test.save?'Save/reopen':'')
 }
 assert.deepEqual(consoleErrors,[]);fs.writeFileSync(shotPath('alignment-results.json'),JSON.stringify(results,null,2));console.log('ALL PASS')
} catch(error) {await page.screenshot({path:shotPath("failure.png")});fs.writeFileSync(shotPath("failure.html"),await page.content());console.log(await page.evaluate(async()=>{const s=(await import("/src/state/store.ts")).useStore.getState();return {status:s.status,error:s.error,busy:s.busy,applied:s.appliedAlignment}}));throw error} finally {await browser.close()}

