// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic planar scan; exercise the actual rendered grips with mouse input.
import {writeFileSync,mkdirSync,mkdtempSync,readdirSync} from 'node:fs'
import {join} from 'node:path'
import {launchApp,loadScan,check,fail,finish,shotPath,sleep} from './e2e-lib.mjs'
const mesh=[]
for(let y=0;y<5;y++)for(let x=0;x<5;x++)mesh.push(`v ${x*5} ${y*5} 3`)
for(let y=0;y<4;y++)for(let x=0;x<4;x++){const a=y*5+x+1;mesh.push(`f ${a} ${a+1} ${a+6}`,`f ${a} ${a+6} ${a+5}`)}
const fixture=shotPath('handles-plane.obj');writeFileSync(fixture,mesh.join('\n'))
const {browser,page,consoleErrors}=await launchApp({agentDataOk:false})
try{
 const downloadsRoot=shotPath('handle-projects');mkdirSync(downloadsRoot,{recursive:true})
 const downloads=mkdtempSync(join(downloadsRoot,'run-'))
 const cdp=await browser.target().createCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads})
 await loadScan(page,fixture)
 await page.click('[data-test=ribbon-extract-primitives]')
 await page.click('[data-test=extract-select-all]')
 await page.waitForFunction(()=>!document.querySelector('[data-test=extract-type-plane]').disabled)
 await page.click('[data-test=extract-type-plane]')
 await page.waitForSelector('[data-test=extract-preview]')
 // Selection gestures deliberately own the mouse until Navigate is chosen.
 await page.click('[data-test=extract-tool-navigate]')
 await page.waitForFunction(()=>window.__scanruler.scene().grips.handles.length===9)
 const canvas=await page.$eval('.viewport canvas',e=>{const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})
 await page.mouse.move(canvas.x,canvas.y);await page.mouse.wheel({deltaY:450});await sleep(250)
 const fitBefore=await page.evaluate(()=>JSON.stringify(window.__scanruler.measure.getState().draft.fit))
 const handles=await page.evaluate(()=>window.__scanruler.scene().grips.handles.map(h=>({side:h.side,shape:h.mesh.geometry.name,color:h.color,size:h.screen?.size})))
 check(handles.filter(h=>!h.side.includes(':')&&h.side!=='planeRotate').every(h=>h.shape==='plane-arrow-handle'&&h.color==='#ffd400'&&h.size===18),'four yellow shaft-and-head plane arrows use constant pixel sizing')
 check(handles.filter(h=>h.side.includes(':')).length===4&&handles.some(h=>h.shape==='plane-rotation-handle'),'four corner arrows and a curved rotation control are available')
 // Locate a projected arrow, then use real mouse input rather than calling resize.
 const aim=await page.evaluate(()=>{
  const s=window.__scanruler.scene(),camera=s.viewLink().camera
  const r=document.querySelector('.viewport canvas').getBoundingClientRect()
  const project=p=>{p.project(camera);return {x:r.x+(p.x+1)*r.width/2,y:r.y+(1-p.y)*r.height/2}}
  return s.grips.handles.filter(h=>!h.corner&&!h.ring).map(h=>{
   const p=h.mesh.getWorldPosition(h.position.clone()),a=project(p.clone())
   const d=h.dir.clone().transformDirection(s.partGroup.matrixWorld)
   const b=project(p.clone().addScaledVector(d,10)),dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy)
   return {...a,dx:dx/l*30,dy:dy/l*30,l}
  }).filter(a=>a.x>360&&a.x<innerWidth-40&&a.y>170&&a.y<innerHeight-40).sort((a,b)=>b.l-a.l)[0]
 })
 if(!aim)throw Error('No accessible projected plane grip')
 await page.mouse.move(aim.x,aim.y);await sleep(100)
 await page.mouse.down();await page.mouse.move(aim.x+aim.dx,aim.y+aim.dy,{steps:12});await page.mouse.up();await sleep(300)
 const after=await page.evaluate(()=>({extend:window.__scanruler.measure.getState().draft.extend,fit:JSON.stringify(window.__scanruler.measure.getState().draft.fit)}))
 check(Object.values(after.extend??{}).some(v=>typeof v==='number'&&Math.abs(v)>0.01),'dragging an arrow changes the plane extents')
 check(after.fit===fitBefore,'resizing preserves the measured plane normal, position and fit statistics')
 const corner=await page.evaluate(()=>{
  const s=window.__scanruler.scene(),camera=s.viewLink().camera,r=document.querySelector('.viewport canvas').getBoundingClientRect()
  const project=p=>{p.project(camera);return {x:r.x+(p.x+1)*r.width/2,y:r.y+(1-p.y)*r.height/2}}
  return s.grips.handles.filter(h=>h.corner).map(h=>{
   const p=h.mesh.getWorldPosition(h.position.clone()),a=project(p.clone())
   const b=project(p.clone().addScaledVector(h.dir.clone().transformDirection(s.partGroup.matrixWorld),10))
   const l=Math.hypot(b.x-a.x,b.y-a.y)
   return {...a,dx:(b.x-a.x)/l*35,dy:(b.y-a.y)/l*35,u:h.corner.uSide,v:h.corner.vSide}
  }).find(a=>a.x>0&&a.x<innerWidth&&a.y>0&&a.y<innerHeight&&document.elementFromPoint(a.x,a.y)?.tagName==='CANVAS')
 })
 if(!corner)throw Error('No accessible projected corner grip')
 const cornerBefore=await page.evaluate(()=>window.__scanruler.measure.getState().draft.extend)
 await page.mouse.move(corner.x,corner.y);await sleep(100);await page.mouse.down()
 await page.mouse.move(corner.x+corner.dx,corner.y+corner.dy,{steps:12});await page.mouse.up();await sleep(200)
 const cornerAfter=await page.evaluate(()=>window.__scanruler.measure.getState().draft.extend)
 check(Math.abs((cornerAfter[corner.u]??0)-(cornerBefore?.[corner.u]??0))>0.01&&Math.abs((cornerAfter[corner.v]??0)-(cornerBefore?.[corner.v]??0))>0.01,'a corner drag resizes both adjoining edges')
 check(['uMin','uMax','vMin','vMax'].filter(k=>k!==corner.u&&k!==corner.v).every(k=>(cornerAfter[k]??0)===(cornerBefore?.[k]??0)),'corner resizing leaves both opposite edges unchanged')
 const turn=await page.evaluate(()=>{
  const s=window.__scanruler.scene(),h=s.grips.handles.find(h=>h.side==='planeRotate'),camera=s.viewLink().camera,r=document.querySelector('.viewport canvas').getBoundingClientRect()
  h.mesh.updateWorldMatrix(true,false)
  const project=p=>{p.project(camera);return {x:r.x+(p.x+1)*r.width/2,y:r.y+(1-p.y)*r.height/2}}
  const p=h.position.clone().set(Math.cos(1),Math.sin(1),0).applyMatrix4(h.mesh.matrixWorld)
  const a=project(p),center=project(h.position.clone().applyMatrix4(s.partGroup.matrixWorld))
  const dx=a.x-center.x,dy=a.y-center.y,t=0.18
  return {...a,toX:center.x+dx*Math.cos(t)-dy*Math.sin(t),toY:center.y+dx*Math.sin(t)+dy*Math.cos(t)}
 })
 const pose=()=>page.evaluate(()=>{const s=window.__scanruler.scene();return {center:s.grips.fit.center,normal:s.grips.fit.normal,extentU:s.grips.fit.extentU,extentV:s.grips.fit.extentV,rotation:window.__scanruler.measure.getState().draft.extend?.rotation??0}})
 const poseBefore=await pose()
 await page.mouse.move(turn.x,turn.y);await sleep(100);await page.mouse.down();await page.mouse.move(turn.toX,turn.toY,{steps:14});await page.mouse.up();await sleep(200)
 const poseAfter=await pose()
 check(Math.abs(poseAfter.rotation-poseBefore.rotation)>1,'dragging the curved control spins the rectangular patch')
 check(poseAfter.center.every((v,i)=>Math.abs(v-poseBefore.center[i])<1e-8)&&JSON.stringify(poseAfter.normal)===JSON.stringify(poseBefore.normal)&&Math.abs(poseAfter.extentU-poseBefore.extentU)<1e-8&&Math.abs(poseAfter.extentV-poseBefore.extentV)<1e-8,'rotation keeps the drawn centre, normal and dimensions fixed')
 check(await page.evaluate(before=>JSON.stringify(window.__scanruler.measure.getState().draft.fit)===before,fitBefore),'corner resize and rotation preserve the original measured fit')
 await page.screenshot({path:shotPath('widget-plane-handle-drag.png')})
 const finalExt=await page.evaluate(()=>window.__scanruler.measure.getState().draft.extend)
 await page.click('[data-test=extract-create]')
 check(await page.evaluate(ext=>JSON.stringify(window.__scanruler.measure.getState().elements[0].extend)===JSON.stringify(ext),finalExt),'Create commits the dragged size and rotation')
 await page.evaluate(async()=>(await import('/src/state/historyStore.ts')).undo())
 check(await page.evaluate(()=>window.__scanruler.measure.getState().elements.length===0),'Undo removes the edited plane')
 await page.evaluate(async()=>(await import('/src/state/historyStore.ts')).redo())
 check(await page.evaluate(ext=>JSON.stringify(window.__scanruler.measure.getState().elements[0].extend)===JSON.stringify(ext),finalExt),'Redo restores the size and rotation')
 await page.click('[data-test=save-project]')
 let file
 for(let n=0;n<100&&!file;n++){await sleep(100);const name=readdirSync(downloads).find(f=>f.endsWith('.scanruler'));if(name)file=join(downloads,name)}
 if(!file)throw Error('Plane project download missing')
 await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('.panel')
 await (await page.$('[data-test=project-input]')).uploadFile(file)
 await page.waitForFunction(()=>/Project opened/.test(document.querySelector('.strip')?.textContent??'')&&window.__scanruler.measure.getState().elements[0]?.status==='done',{timeout:120000})
 check(await page.evaluate(ext=>JSON.stringify(window.__scanruler.measure.getState().elements[0].extend)===JSON.stringify(ext),finalExt),'save/reopen preserves the dragged plane dimensions and rotation')
 await page.click('.explorer-group .explorer-item[title="plane · Double-click to edit"]',{count:2})
 await page.waitForFunction(()=>window.__scanruler.measure.getState().draft?.editId!==undefined)
 check(await page.evaluate(ext=>JSON.stringify(window.__scanruler.measure.getState().draft.extend)===JSON.stringify(ext),finalExt),'double-click editing restores the same patch pose')
 check(await page.evaluate(()=>window.__scanruler.scene().marking.paint.color==='#ffffff'),'ordinary entity editing also restores its selected scan data in white')
 await page.keyboard.press('Escape')
 await page.click('[data-test=ribbon-extract-primitives]');await page.click('[data-test=extract-select-all]')
 await page.click('[data-test=extract-type-plane]');await page.waitForSelector('[data-test=extract-preview]')
 await page.click('[data-test=extract-close]');await page.click('[data-test=extract-close-no]')
 check(await page.evaluate(ext=>!window.__scanruler.measure.getState().draft&&window.__scanruler.measure.getState().elements.length===1&&JSON.stringify(window.__scanruler.measure.getState().elements[0].extend)===JSON.stringify(ext),finalExt),'Close / No discards a new preview while preserving the committed rotated plane')
}catch(error){fail(error.stack??String(error))}
finally{await finish(browser,consoleErrors)}
