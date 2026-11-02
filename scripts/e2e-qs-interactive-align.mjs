// SPDX-License-Identifier: AGPL-3.0-only
import {writeFileSync,mkdirSync,mkdtempSync,readdirSync} from 'node:fs'
import {join} from 'node:path'
import {launchApp,loadScan,check,fail,finish,shotPath,sleep} from './e2e-lib.mjs'
const fixture=shotPath('interactive-box.obj')
writeFileSync(fixture,'v 0 0 0\nv 20 0 0\nv 20 20 0\nv 0 20 0\nv 0 0 20\nv 20 0 20\nv 20 20 20\nv 0 20 20\nf 1 3 2\nf 1 4 3\nf 5 6 7\nf 5 7 8\nf 1 2 6\nf 1 6 5\nf 4 8 7\nf 4 7 3\nf 1 5 8\nf 1 8 4\nf 2 3 7\nf 2 7 6')
const {browser,page,consoleErrors}=await launchApp({agentDataOk:false})
const read=()=>page.evaluate(async()=>{
 const a=(await import('/src/state/interactiveAlignStore.ts')).useInteractiveAlign.getState(),s=window.__scanruler.measure.getState()
 return {open:a.open,r:[...a.rigid.r],t:[...a.rigid.t],applied:s.appliedAlignment?{r:[...s.appliedAlignment.r],t:[...s.appliedAlignment.t]}:null}
})
const open=async()=>{
 await page.click('summary[title="Choose an alignment method"]');await page.click('[data-test=ribbon-align-interactive-]');await page.waitForSelector('[data-test=interactive-align]',{visible:true});await sleep(100)
}
try{
 const downloadsRoot=shotPath('interactive-projects');mkdirSync(downloadsRoot,{recursive:true});const downloads=mkdtempSync(join(downloadsRoot,'run-'))
 const cdp=await browser.target().createCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads})
 await loadScan(page,fixture)
 await page.click('[data-test=ribbon-tab-view]');await page.click('[data-test=ribbon-isometric]');await page.click('[data-test=workspace-elements]')
 await open()
 check(await page.$eval('.inspector-body',e=>e.scrollWidth<=e.clientWidth+1),'the compact alignment widget has no horizontal overflow')
 check(await page.$eval('[data-test=tool-inspector]',e=>e.getAttribute('aria-label')==='Align Interactive'&&Math.abs(e.getBoundingClientRect().width-286)<1),'Align Interactive opens its own compact reference-titled widget')
 check(await page.evaluate(()=>window.__scanruler.scene().grips.handles.filter(h=>h.side.startsWith('align-')).length===6),'three arrows and three quarter-circle rotation arcs are rendered')
 for(const kind of ['r','m'])for(const axis of ['x','y','z']){
  const side=`align-${kind}${axis}`
  const aim=await page.evaluate(({side,kind})=>{
   const s=window.__scanruler.scene(),h=s.grips.handles.find(h=>h.side===side),camera=s.viewLink().camera,r=document.querySelector('.viewport canvas').getBoundingClientRect()
   h.mesh.updateWorldMatrix(true,false)
   const project=p=>{p.project(camera);return {x:r.x+(p.x+1)*r.width/2,y:r.y+(1-p.y)*r.height/2}}
   const p=kind==='r'?h.position.clone().set(Math.SQRT1_2,Math.SQRT1_2,0).applyMatrix4(h.mesh.matrixWorld):h.mesh.getWorldPosition(h.position.clone())
   const a=project(p.clone()),dir=h.dir.clone().transformDirection(s.partGroup.matrixWorld)
   let end
   if(kind==='r'){
    const center=h.position.clone().applyMatrix4(s.partGroup.matrixWorld)
    end=p.clone().sub(center).applyAxisAngle(dir,.25).add(center)
   }else end=p.clone().addScaledVector(dir,4)
   const b=project(end)
   return {...a,toX:b.x,toY:b.y}
  },{side,kind})
  const before=await read()
  await page.mouse.move(aim.x,aim.y);await sleep(100);await page.mouse.down();await page.mouse.move(aim.toX,aim.toY,{steps:15});await page.mouse.up();await sleep(150)
  const after=await read()
  check(kind==='r'?after.r.some((v,i)=>Math.abs(v-before.r[i])>.005):after.t.some((v,i)=>Math.abs(v-before.t[i])>.01),`${side} responds to an actual mouse drag`)
  check(after.applied===null,`${side} changes the preview without baking the scan`)
 }
 await page.screenshot({path:shotPath('interactive-align-gizmo.png')})
 await page.click('[data-test=interactive-cancel]')
 check(!(await read()).open&&(await read()).applied===null,'Cancel drops all preview motion without changing the scan')
 await open();await page.click('[data-test=interactive-move-plus]')
 check(Math.abs((await read()).t[0]-1)<1e-8,'Move along X / plus moves the preview by exactly 1 mm')
 await page.click('[data-test=interactive-move-minus]')
 check(Math.abs((await read()).t[0])<1e-8,'Move minus reverses the increment')
 await page.click('[data-test=interactive-rotate-plus]')
 check(Math.abs((await read()).r[0]-Math.cos(Math.PI/180))<1e-8,'Rotate around Z / plus applies the 1-degree increment')
 await page.evaluate(()=>{
  const c=window.__scanruler.client();window.__savedTransform=c.transform.bind(c)
  c.transform=()=>new Promise((_,reject)=>{window.__rejectAlignment=()=>reject(new Error('Deliberate alignment failure for regression'))})
 })
 await page.click('[data-test=interactive-apply]')
 await page.waitForFunction(()=>typeof window.__rejectAlignment==='function')
 check((await read()).open&&await page.$eval('[data-test=interactive-apply]',e=>e.disabled),'OK keeps the widget open and disabled while the operation is pending')
 await page.evaluate(()=>window.__rejectAlignment());await page.waitForFunction(()=>!window.__scanruler.measure.getState().busy)
 await page.waitForFunction(()=>!document.querySelector('[data-test=interactive-apply]').disabled)
 check((await read()).open&&(await read()).applied===null,'a failed alignment leaves the preview editable and the original scan intact')
 await page.evaluate(()=>{window.__scanruler.client().transform=window.__savedTransform})
 const expected=await read();await page.click('[data-test=interactive-apply]')
 await page.waitForFunction(()=>!window.__scanruler.measure.getState().busy&&window.__scanruler.measure.getState().appliedAlignment!==null)
 check(!(await read()).open&&(await read()).applied.r.every((v,i)=>Math.abs(v-expected.r[i])<1e-8),'OK bakes precisely the preview rotation through the existing alignment session')
 await page.evaluate(async()=>(await import('/src/state/historyStore.ts')).undo());await sleep(200)
 check((await read()).applied===null,'Undo restores the original scan frame')
 await page.evaluate(async()=>(await import('/src/state/historyStore.ts')).redo());await sleep(200)
 check((await read()).applied!==null,'Redo restores the applied alignment')
 await page.click('[data-test=save-project]')
 let file
 for(let n=0;n<100&&!file;n++){await sleep(100);const name=readdirSync(downloads).find(f=>f.endsWith('.scanruler'));if(name)file=join(downloads,name)}
 if(!file)throw Error('Aligned project download missing')
 await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('.panel');await (await page.$('[data-test=project-input]')).uploadFile(file)
 await page.waitForFunction(()=>/Project opened/.test(document.querySelector('.strip')?.textContent??''),{timeout:120000})
 check((await read()).applied?.r.every((v,i)=>Math.abs(v-expected.r[i])<1e-8),'save/reopen preserves the committed alignment frame')
 await open();await page.keyboard.press('Escape')
 check(!(await read()).open,'Escape cancels the transient alignment widget')
 await open();await page.click('[data-test=hide-tool-inspector]')
 check(!(await read()).open,'title-bar X follows the Cancel path')
}catch(error){fail(error.stack??String(error))}finally{await finish(browser,consoleErrors)}
