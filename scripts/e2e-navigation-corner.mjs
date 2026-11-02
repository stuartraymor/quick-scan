// SPDX-License-Identifier: AGPL-3.0-only
import { writeFileSync } from 'node:fs'
import { launchApp, loadScan, repoFile, check, fail, finish, shotPath, sleep } from './e2e-lib.mjs'
const {browser,page,consoleErrors}=await launchApp()
const results=[]
const record=(ok,label)=>{check(ok,label);results.push({ok:!!ok,label})}
const direction=()=>page.evaluate(()=>window.__scanruler.scene().viewDirection())
const pose=()=>page.evaluate(()=>{const l=window.__scanruler.scene().viewLink();return {zoom:l.camera.zoom,target:l.target.toArray(),up:l.camera.up.toArray(),right:l.camera.matrixWorld.elements.slice(0,3)}})
const action=async(text)=>{for(const b of await page.$$('.navigation-menu button')){if((await b.evaluate(e=>e.textContent)).trim().replace(/^\u2713\s*/, '')===text){await b.click();return}}throw Error('missing menu button '+text)}
const enterSpacing=async value=>{await page.click('[aria-label="Grid spacing"]');await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');await page.keyboard.type(value)}
try{
 await loadScan(page,repoFile(process.env.SCAN??'public/reference-examples/basic_part.stl'))
 record(await page.$$eval('.inspector-body .kindrow button', buttons => buttons.length >= 3 && buttons.every(button => button.getBoundingClientRect().right <= button.closest('.inspector-body').getBoundingClientRect().right + 1)), 'primitive controls fit inside the tool inspector without horizontal clipping')
 await page.mouse.move(650,600)
 record(!await page.$('.navigation-menu'),'menu is collapsed away from the corner')
 record(await page.$eval('.navigation-corner',e=>{const r=e.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect();return Math.abs(p.right-r.right-14)<1&&Math.abs(r.top-p.top-14)<1}),'corner anchored14px from top-right')
 await page.click('[aria-label="View navigation menu"]');await page.waitForSelector('.navigation-menu')
 const directions={Top:[0,0,-1],Bottom:[0,0,1],Left:[1,0,0],Right:[-1,0,0],Front:[0,1,0],Back:[0,-1,0]}
 for(const [name,expected] of Object.entries(directions)){
  const before=await pose();await action(name)
  record((await direction()).every((v,i)=>Math.abs(v-expected[i])<1e-5),`${name} menu selects actual camera direction`)
  record((await pose()).zoom===before.zoom,`${name} preserves magnification`)
 }
 const beforeRoll=await pose(),beforeDirection=await direction()
 await action('90° Left');const afterLeft=await pose()
 record(afterLeft.up.reduce((a,v,i)=>a+v*beforeRoll.right[i],0)>.99999,'90 Left turns model counterclockwise as reference does')
 record((await direction()).every((v,i)=>Math.abs(v-beforeDirection[i])<1e-5)&&(await pose()).zoom===beforeRoll.zoom,'roll preserves direction and magnification')
 await action('90° Right');record((await pose()).up.every((v,i)=>Math.abs(v-beforeRoll.up[i])<1e-5),'opposite rolls restore camera up')
 for(const [side,inverse] of [['up','down'],['left','right']]){
  const d=await direction(),before=await pose();await page.click(`[aria-label="Rotate view ${side}"]`);const turned=await direction();record(turned.some((v,i)=>Math.abs(v-d[i])>0.1)&&before.zoom===(await pose()).zoom,`orbit ${side} rotates camera preserving scale`);await page.click(`[aria-label="Rotate view ${inverse}"]`);record((await direction()).every((v,i)=>Math.abs(v-d[i])<1e-5),`orbit ${inverse} reverses ${side}`)
 }
 await action('Isometric');const iso=await direction();record(iso[0]<0&&iso[1]>0&&iso[2]<0,'Isometric selects front/top/right')
 for(const [face,view] of Object.entries({'+x':'right','-x':'left','+y':'rear','-y':'front','+z':'top','-z':'bottom'})){
  await page.evaluate(view=>window.__scanruler.scene().viewFrom(view),view);await sleep(100)
  const point=await page.evaluate(face=>{const g=window.__scanruler.scene().gizmo,d=g.drawn,p=g.cube.position.clone();p.setComponent('xyz'.indexOf(face[1]),face[0]==='+'?.72:0);p.project(g.camera);const r=document.querySelector('.viewport canvas').getBoundingClientRect();return [r.x+d.x+(p.x+1)*d.size/2,r.y+d.y+(1-p.y)*d.size/2]},face)
  await page.mouse.click(...point);await sleep(100)
  const expected=directions[view==='rear'?'Back':view[0].toUpperCase()+view.slice(1)]
  record((await direction()).every((v,i)=>Math.abs(v-expected[i])<1e-5),`cube ${face} selects signed view without flipping`)
 }
 await action('Coordinate System')
 record(await page.evaluate(()=>window.__scanruler.scene().navigationGuides.coordinates.visible),'Coordinate System shows actual origin axes')
 await page.click('[aria-label="Coordinate System visibility"]')
 record(await page.evaluate(()=>!window.__scanruler.scene().navigationGuides.coordinates.visible),'Objects visibility synchronizes with corner coordinates')
 await action('Grid ...');await page.waitForSelector('dialog[open]');await page.click('.navigation-grid-dialog input[type=checkbox]');await enterSpacing('5');await page.click('.navigation-grid-dialog button[type=submit]');await page.waitForSelector('dialog[open]',{hidden:true})
 await action('Top');await sleep(100)
 console.log('GRID',await page.evaluate(()=>{const g=window.__scanruler.scene().navigationGuides;return {visible:g.grid.visible,spacing:g.spacing,children:g.grid.children.length}}))
 record(await page.evaluate(()=>{const g=window.__scanruler.scene().navigationGuides;return g.grid.visible&&g.spacing===5&&g.grid.children.length>0}),'Grid Enable and spacing5 render real world-unit geometry')
 await action('Isometric');await sleep(100)
 record(await page.evaluate(()=>!window.__scanruler.scene().navigationGuides.grid.visible),'grid hides in iso with coordinates off')
 await action('Coordinate System');await sleep(100)
 record(await page.evaluate(()=>{const g=window.__scanruler.scene().navigationGuides;return g.grid.visible&&g.coarseGrid.visible&&g.coordinates.visible}),'coordinates enables world XY fine and coarse grids in iso')
 await action('Coordinate System');await sleep(100)
 record(await page.evaluate(()=>{const g=window.__scanruler.scene().navigationGuides;return !g.grid.visible&&!g.coarseGrid.visible}),'hiding coordinates removes iso grids again')
 await action('Grid ...');await page.click('.navigation-grid-dialog input[type=checkbox]');await page.click('.navigation-grid-dialog footer button[type=button]')
 await action('Top');await sleep(100)
 record(await page.evaluate(()=>window.__scanruler.scene().navigationGuides.grid.visible),'Grid Cancel preserves previous enabled state')
 await action('Grid ...');await enterSpacing('0')
 record(await page.$eval('.navigation-grid-dialog button[type=submit]',e=>e.disabled),'invalid zero spacing cannot be accepted')
 await page.keyboard.press('Escape');await page.waitForSelector('dialog[open]',{hidden:true})
 await page.evaluate(()=>window.__scanruler.scene().fitBox([500,500,500],[505,505,505]));await action('Zoom to Fit (A)')
 record(await page.evaluate(()=>{const s=window.__scanruler.scene(),c=window.__scanruler.measure.getState().modelCenter;return s.viewLink().target.distanceTo({x:c[0],y:c[1],z:c[2]})<1e-5}),'Zoom to Fit returns camera to actual model centre')
 record(await page.evaluate(()=>window.__scanruler.measure.getState().elements.length===0),'navigation creates no model features')
 await page.evaluate(()=>window.__scanruler.measure.getState().startDraft('point'))
 await action('Grid ...');await page.waitForSelector('dialog[open]');await page.keyboard.press('Escape');await page.waitForSelector('dialog[open]',{hidden:true})
 record(await page.evaluate(()=>!!window.__scanruler.measure.getState().draft),'Grid Escape leaves underlying model draft intact')
 await page.click('[aria-label="View navigation menu"]');await page.keyboard.press('Escape')
 record(!await page.$('.navigation-menu'),'Escape dismisses a keyboard-pinned/hovered menu')
 record(await page.evaluate(()=>!!window.__scanruler.measure.getState().draft),'menu Escape leaves underlying model draft intact')
 await page.evaluate(()=>window.__scanruler.measure.getState().cancelDraft());await page.mouse.move(650,600);await page.click('[aria-label="View navigation menu"]')
 await action('Isometric');await page.mouse.move(650,600);await page.screenshot({path:shotPath('corner-collapsed.png')})
 await page.mouse.move(1440,280);await page.screenshot({path:shotPath('corner-menu.png')})
}catch(e){fail(e.stack??String(e))}finally{writeFileSync(shotPath('corner-results.json'),JSON.stringify(results,null,2));await finish(browser,consoleErrors)}
