// SPDX-License-Identifier: AGPL-3.0-only
// Known 3-degree and 42-degree creases, plus a disconnected patch.
import {writeFileSync} from 'node:fs'
import {launchApp,loadScan,check,fail,finish,shotPath,sleep} from './e2e-lib.mjs'
const mesh=[]
for(let y=0;y<5;y++)for(let x=0;x<10;x++){
 const z=Math.max(Math.min(x,7)-4,0)*5*Math.tan(3*Math.PI/180)+Math.max(x-7,0)*5
 mesh.push(`v ${x*5} ${y*5} ${z}`)
}
for(let y=0;y<4;y++)for(let x=0;x<9;x++){const a=y*10+x+1;mesh.push(`f ${a} ${a+1} ${a+11}`,`f ${a} ${a+11} ${a+10}`)}
mesh.push('v 65 0 0','v 70 0 0','v 70 5 0','v 65 5 0','f 51 52 53','f 51 53 54')
const fixture=shotPath('wand-creases.obj');writeFileSync(fixture,mesh.join('\n'))
const {browser,page,consoleErrors}=await launchApp({agentDataOk:false})
const count=()=>page.evaluate(async()=>(await import('/src/state/markStore.ts')).useMark.getState().count)
const degrees=async text=>{
 await page.click('[data-test=extract-degrees]');await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await page.keyboard.type(text);await page.keyboard.press('Enter');await sleep(180)
}
try{
 await loadScan(page,fixture)
 check(await page.evaluate(()=>document.documentElement.dataset.theme==='dark'),'new sessions default to the charcoal theme')
 await page.click('[data-test=ribbon-extract-primitives]')
 check(await page.$eval('[data-test=tool-inspector]',e=>getComputedStyle(e).backgroundColor==='rgb(37, 40, 44)'),'extraction widget follows the dark gray theme')
 check(await page.$eval('[data-test=extract-tool-wand]',e=>e.getAttribute('aria-pressed')==='true'),'opening Extract Primitives arms Magic Wand for the first surface click')
 await page.click('[data-test=extract-tool-wand]')
 check(await page.$eval('[data-test=extract-tool-wand]',e=>e.getAttribute('aria-pressed')==='true'),'clicking the selected Magic Wand keeps it armed')
 await degrees('2')
 const at=await page.evaluate(()=>{
  const s=window.__scanruler.scene(),mesh=s.marking.ctx.mesh(),p=mesh.position.clone().set(17.5,7.5,0)
  mesh.localToWorld(p);p.project(s.viewLink().camera)
  const r=document.querySelector('.viewport canvas').getBoundingClientRect()
  const x=r.x+(p.x+1)*r.width/2,y=r.y+(1-p.y)*r.height/2
  return {x,y,target:document.elementFromPoint(x,y)?.outerHTML.slice(0,100),meshPosition:mesh.position.toArray(),bounds:mesh.geometry.boundingBox}
 })
 await page.mouse.click(1100,800);await sleep(80)
 check(await count()===0&&await page.$('[data-test=extract-quick]')===null,'empty space before the first pick does not offer primitive creation')
 console.log('wand aim',JSON.stringify(at));await page.mouse.click(at.x,at.y);await sleep(200);console.log('initial count',await count())
 check(await count()===25,'2 degrees stops at the known 3-degree crease (25 vertices)')
 check(await page.evaluate(()=>window.__scanruler.scene().marking.paint.color==='#ffffff'&&window.__scanruler.scene().uPaintColor.value.getHexString()==='ffffff'),'selection session and rendered tint uniform are white')
 await page.waitForSelector('[data-test=extract-quick]',{visible:true})
 const layout = () => page.evaluate(() => {
  const bounds = e => { const r=e.getBoundingClientRect(); return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height} }
  const popup=bounds(document.querySelector('[data-test=extract-quick]')), viewport=bounds(document.querySelector('.viewport')), panel=bounds(document.querySelector('[data-test=tool-inspector]'))
  const rows=[...document.querySelectorAll('.qs-iconrow,.qs-typerow,.qs-quick-types')].map(row=>{
   const boxes=[...row.querySelectorAll('button')].map(bounds), icons=[...row.querySelectorAll('svg')].map(bounds)
   const gaps=boxes.slice(1).map((b,i)=>b.left-boxes[i].right)
   return {gaps,inside:icons.every((icon,i)=>icon.left>=boxes[i].left&&icon.right<=boxes[i].right&&icon.top>=boxes[i].top&&icon.bottom<=boxes[i].bottom)}
  })
  return {popup,viewport,panel,rows,overlap:popup.left<panel.right&&popup.right>panel.left&&popup.top<panel.bottom&&popup.bottom>panel.top}
 })
 const firstLayout=await layout()
 check((Math.abs(firstLayout.popup.left+firstLayout.popup.width/2-at.x)<1||Math.abs(firstLayout.popup.left-firstLayout.panel.right-8)<1)&&Math.abs(firstLayout.popup.top-(at.y-132))<1,'quick tools sit above the pick, centred or shifted clear of the inspector')
 for(const width of [1500,1139,900]){
  await page.setViewport({width,height:950});await sleep(120)
  const l=await layout()
  check(l.rows.every(r=>r.inside&&r.gaps.every(g=>g>=0)&&Math.max(...r.gaps)-Math.min(...r.gaps)<1),`icons stay inside evenly spaced non-overlapping buttons at ${width}px`)
  check(!l.overlap&&l.popup.left>=l.viewport.left&&l.popup.right<=l.viewport.right&&l.popup.top>=l.viewport.top&&l.popup.bottom<=l.viewport.bottom,`popup stays in the viewport and clear of the inspector at ${width}px`)
 }
 await page.setViewport({width:1500,height:950});await sleep(150)
 await page.mouse.click(1100,800);await sleep(100)
 check(await page.$('[data-test=extract-quick]')!==null&&await count()===25,'empty-space click repositions quick tools and keeps the existing selection, as in the reference')
 await page.mouse.move(at.x,at.y);await page.mouse.down();await page.mouse.move(at.x+20,at.y,{steps:4});await page.mouse.up();await sleep(100)
 check(await page.$('[data-test=extract-quick]')===null,'a drag does not leave a quick-tools popup at the drag origin')
 await page.keyboard.down('Shift');await page.mouse.click(1100,800);await page.keyboard.up('Shift');await sleep(80)
 check(await page.$('[data-test=extract-quick]')===null,'modified camera clicks do not open quick tools')
 await page.mouse.click(at.x,at.y);await page.waitForSelector('[data-test=extract-quick]')

 await degrees('6')
 check(await count()===40,'raising degrees regrows the same pick across 3 degrees but stops at the 42-degree crease')
 await degrees('2')
 check(await count()===25,'lowering degrees shrinks the same pick without another click')
 await degrees('0.25')
 check(await page.$eval('[data-test=extract-degrees]',e=>e.value==='0.25'),'partial decimal typing accepts 0.25 degrees without jumping to the minimum')
 check(await count()===25,'a fractional degree preserves the flat patch selection')
 await page.click('[data-test=extract-connected]');await sleep(180)
 check(await count()===50,'connected mode crosses both creases but excludes the disconnected patch')
 check(await page.$eval('[data-test=extract-degrees]',e=>e.disabled)&&await page.$eval('[data-test=extract-degrees-slider]',e=>e.disabled),'connected mode disables both angle fields')
 await page.click('[data-test=extract-connected]');await sleep(180)
 check(await count()===25,'leaving connected mode restores the chosen fractional threshold')
 await page.$eval('[data-test=extract-quick-degrees]',e=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(e,'6');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))});await sleep(180)
 check(await count()===40&&await page.$eval('[data-test=extract-degrees]',e=>e.value==='6'),'quick-tools slider synchronizes the angle and live selection')
 await degrees('2');await page.screenshot({path:shotPath('wand-white-selection.png')})
 await page.click('[data-test=extract-enlarge]');await sleep(150)
 const enlarged=await count();check(enlarged>25,'Enlarge adds the adjoining triangle ring')
 await page.click('[data-test=extract-shrink]');await sleep(150)
 check(await count()<enlarged,'Shrink removes the outer selection ring')
 await page.click('[data-test=extract-deselect]');await sleep(100)
 check(await count()===0,'Deselect clears the selected area')
 await page.mouse.click(at.x,at.y);await sleep(150)
 check(await count()===25,'wand repicks the same area after clearing')
 await page.click('[data-test=extract-type-plane]');await page.waitForSelector('[data-test=extract-preview]')
 check(await page.evaluate(()=>window.__scanruler.measure.getState().draft.fit.sigma<1e-8),'creating a plane from the wand selection fits the known flat face')
 await page.click('[data-test=extract-create-stay]');await sleep(150)
 check(await page.evaluate(()=>window.__scanruler.measure.getState().elements.length===1&&!window.__scanruler.measure.getState().draft)&&await count()===0,'Create & Stay commits one entity and clears the old selection')
 await page.click('[data-test=extract-tool-navigate]')
 check(await page.$eval('[data-test=extract-tool-navigate]',e=>e.getAttribute('aria-pressed')==='true'),'Navigate explicitly releases the selection tool')
 await degrees('3')
 check(await page.$eval('[data-test=extract-tool-navigate]',e=>e.getAttribute('aria-pressed')==='true'),'angle changes do not unexpectedly re-arm the wand after Navigate')
 await page.click('[data-test=extract-close]')
}catch(error){fail(error.stack??String(error))}
finally{await finish(browser,consoleErrors)}
