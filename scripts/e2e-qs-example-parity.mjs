// SPDX-License-Identifier: AGPL-3.0-only
import {writeFileSync} from 'node:fs'
import {launchApp,check,fail,finish,shotPath,sleep} from './e2e-lib.mjs'
const {browser,page,consoleErrors}=await launchApp({agentDataOk:false,protocolTimeout:180000})
page.on('dialog',d=>d.accept())
const results=[]
const state=()=>page.evaluate(async()=>{const s=(await import('/src/state/interactiveAlignStore.ts')).useInteractiveAlign.getState();return {open:s.open,r:[...s.rigid.r],t:[...s.rigid.t],mirror:s.mirror,asView:s.asView}})
try{
 for(const id of ['basic_part','lego','impeller']){
  await page.click('[data-test=ribbon-tab-help]');await page.click('[data-test=examples-menu] summary');await page.click(`[data-test=example-${id}]`)
  await page.waitForFunction(name=>window.__scanruler.measure.getState().fileName===name&&!window.__scanruler.measure.getState().busy,{timeout:120000},id+'.stl')
  await page.click('[data-test=workspace-elements]')
  const original=await page.evaluate(()=>{const a=window.__scanruler.scene().marking.ctx.mesh().geometry.attributes.position.array;return Array.from(a.slice(0,60))})
  await page.click('summary[title="Choose an alignment method"]');await page.click('[data-test=ribbon-align-interactive-]');await page.waitForSelector('[data-test=interactive-align]')
  check(await page.$eval('[data-test=tool-inspector]',e=>Math.abs(e.getBoundingClientRect().height-385)<2),`${id}: alignment widget matches the observed reference height`)
  if(!await page.$eval('[data-test=interactive-mirror]',e=>e.checked))await page.click('[data-test=interactive-mirror]')
  for(const plane of ['OYZ','OXZ','OXY']){
   await page.select('[data-test=interactive-mirror-plane]',plane);await sleep(70)
   const reflected=await page.evaluate(plane=>{
    const scene=window.__scanruler.scene(),ghost=scene.alignMirror
    if(!ghost||ghost.name!=='alignment-mirror-preview')return false
    const input=scene.partGroup.matrixWorld.elements,output=ghost.matrix.elements,axis={OYZ:0,OXZ:1,OXY:2}[plane]
    return output.every((n,i)=>Math.abs(n-input[i]*(i%4===axis?-1:1))<1e-7)
   },plane)
   check(reflected,`${id}: ${plane} reflects the preview across its global coordinate plane`)
  }
  await page.click('[data-test=interactive-current-view]');await sleep(120)
  const basis=await page.evaluate(async()=>{
   const s=(await import('/src/state/interactiveAlignStore.ts')).useInteractiveAlign.getState(),c=s.center,r=s.rigid
   const center=[0,1,2].map(i=>r.r[i*3]*c[0]+r.r[i*3+1]*c[1]+r.r[i*3+2]*c[2]+r.t[i])
   const q=window.__scanruler.scene().viewLink().camera.quaternion
   return {center,camera:[q.x,q.y,q.z,q.w]}
  })
  check(basis.center.every(n=>Math.abs(n)<1e-7)&&(await state()).asView,`${id}: As Current View previews a centred model in the view frame`)
  check(basis.camera.slice(0,3).every(n=>Math.abs(n)<1e-7),`${id}: As Current View switches to the XY-facing view`)
  await page.screenshot({path:shotPath(`${id}-align-mirror.png`)})
  await page.click('[data-test=interactive-cancel]');await sleep(120)
  check(await page.evaluate(original=>{const scene=window.__scanruler.scene(),a=scene.marking.ctx.mesh().geometry.attributes.position.array;return !scene.alignMirror&&original.every((n,i)=>n===a[i])&&window.__scanruler.measure.getState().appliedAlignment===null},original),`${id}: Cancel removes the ghost and preserves original scan coordinates`)
  if(id==='impeller')continue
  await page.click('[data-test=ribbon-extract-primitives]')
  const pick=await page.evaluate(()=>{
   const scene=window.__scanruler.scene(),mesh=scene.marking.ctx.mesh(),g=mesh.geometry,p=g.attributes.position,index=g.index.array,view=scene.viewLink().camera,canvas=document.querySelector('.viewport canvas').getBoundingClientRect()
   const candidates=[]
   for(let t=0;t<index.length/3;t+=37){
    const a=mesh.position.clone().fromBufferAttribute(p,index[t*3]),b=mesh.position.clone().fromBufferAttribute(p,index[t*3+1]),c=mesh.position.clone().fromBufferAttribute(p,index[t*3+2])
    const area=b.clone().sub(a).cross(c.clone().sub(a)).length()
    const center=a.clone().add(b).add(c).divideScalar(3);mesh.localToWorld(center);center.project(view)
    const x=canvas.x+(center.x+1)*canvas.width/2,y=canvas.y+(1-center.y)*canvas.height/2
    if(x>550&&x<innerWidth-250&&y>240&&y<innerHeight-100&&document.elementFromPoint(x,y)?.tagName==='CANVAS')candidates.push({x,y,area})
   }
   candidates.sort((a,b)=>b.area-a.area)
   return candidates.filter(at=>{scene.marking.ctx.setPickRay(at.x,at.y);return scene.marking.ctx.raycaster.intersectObject(mesh,false).length>0}).slice(0,40)
  })
  if(!pick.length)throw Error('No visible test face '+id)
  let selected=0,attempts=0,chosen=null
  for(const at of pick){
   await page.click('[data-test=extract-deselect]').catch(()=>{})
   await page.mouse.click(at.x,at.y);await sleep(50)
   selected=await page.evaluate(async()=>(await import('/src/state/markStore.ts')).useMark.getState().count)
   attempts++;if(selected>=20){chosen=at;break}
  }
  if(!chosen)throw Error('No sufficiently large coherent surface patch in '+id+' after '+attempts+' seed clicks')
  check(await page.evaluate(()=>window.__scanruler.scene().uPaintColor.value.getHexString()==='ffffff'),`${id}: wand click visibly uses the white selection tint`)
  await page.waitForSelector('[data-test=extract-quick]')
  await page.click('[data-test=extract-quick-plane]');await page.waitForSelector('[data-test=extract-preview]')
  const fit=await page.evaluate(()=>window.__scanruler.measure.getState().draft.fit)
  check(Number.isFinite(fit.sigma),`${id}: quick-tools Plane button produces a finite fitted primitive preview`)
  results.push({id,selected,pick:chosen,attempts,fit})
  await page.screenshot({path:shotPath(`${id}-wand-plane.png`)})
  await page.click('[data-test=extract-close]');await page.click('[data-test=extract-close-no]')
 }
 writeFileSync(shotPath('example-parity-results.json'),JSON.stringify(results,null,2))
}catch(error){fail(error.stack??String(error))}finally{await finish(browser,consoleErrors)}
