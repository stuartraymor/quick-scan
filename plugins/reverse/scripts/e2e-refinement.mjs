// SPDX-License-Identifier: AGPL-3.0-only
// Focused actual-browser checks of the independent sketch controls. Seeds use the
// existing DEV bridge; commands, selections, drawing and dimensions use real UI.
import { writeFileSync } from 'node:fs'
import { check, click, finish, launchApp, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { openReverse, reverseHelpers } from './lib.mjs'
const {browser,page,consoleErrors}=await launchApp({width:1500,height:960,protocolTimeout:600_000})
const {re}=reverseHelpers(page)
const evidence=[]
const test=async(name,fn)=>{try{await fn();evidence.push({name,status:'completed'})}catch(e){check(false,`${name}: ${e.message}`);evidence.push({name,status:'error',error:e.message});await page.screenshot({path:shotPath(`error-${name.replace(/\W/g,'-')}.png`)})}}
const state=()=>re(()=>window.__re.store.getState().sketchDraft)
const frame={origin:[0,0,0],normal:[0,0,1],basisU:[1,0,0],basisV:[0,1,0]}
const seed=async(entities=[])=>{await re((f,es)=>window.__re.store.getState().startSketch({kind:'world',axis:'z',offset:0},f,es),frame,entities);await sleep(350);await click(page,'[data-test=sketch-tool-select]');await sleep(80)}
const client=async(p)=>re(p=>{const q=window.__re.sheet().sheetScreenPoint(p);return [q.x,q.y]},p)
const pick=async(p)=>{const [x,y]=await client(p);await page.mouse.click(x,y);await sleep(90)}
const move=async(p)=>{const [x,y]=await client(p);await page.mouse.move(x,y);await sleep(100)}
const safe=async()=>re(()=>{const r=document.querySelector('[data-test=sketch-viewport]').getBoundingClientRect();const s=window.__re.sheet();const left=Math.max(r.left+380,r.left+r.width*.57), top=r.top+r.height*.45;return [[left,top],[left+100,top],[left+100,top-80],[left+40,top+75]].map(([x,y])=>s.sheetPoint(x,y))})
const undo=async()=>{await page.keyboard.down('Control');await page.keyboard.press('z');await page.keyboard.up('Control');await sleep(180)}
await openReverse(page)
if(await page.$('[data-test=support-card] .sc-x'))await click(page,'[data-test=support-card] .sc-x')
await seed()

await test('collinear-through-end-picks',async()=>{
 await seed();const [a,b,c]=await safe(),span=Math.abs(b[0]-a[0]),rise=Math.abs(c[1]-a[1])*.4
 await seed([{kind:'line',a,b,fixed:true},{kind:'line',a:[a[0],a[1]+rise],b:[b[0],a[1]+rise*1.2]}])
 await click(page,'[data-test=sketch-rel-collinear]');await pick(a);await pick([a[0],a[1]+rise]);const d=await state()
 check(d.sketch.constraints.some(c=>c.kind==='collinear'),'Collinear selected before geometry creates a collinear equation even when ends are clicked')
 const l=d.sketch.entities[1];check(Math.abs(l.a[1]-a[1])<1e-5&&Math.abs(l.b[1]-a[1])<1e-5,'collinear solves BOTH ends onto fixed reference')
 await undo();check(!(await state()).sketch.constraints.some(c=>c.kind==='collinear'),'one undo removes relation')
})
await test('duplicate-active-units',async()=>{
 await seed();const [a,b]=await safe();await seed([{kind:'line',a,b}])
 await re(async()=>{(await import('/src/state/prefsStore.ts')).usePrefs.getState().setUnits('in')})
 await pick([(a[0]+b[0])/2,a[1]]);await click(page,'[data-test=sketch-duplicate]')
 const fill=async(id,v)=>{await click(page,'[data-test='+id+']');await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');await page.keyboard.type(v);await page.keyboard.press('Tab')}
 await fill('sketch-duplicate-x','1');await fill('sketch-duplicate-y','0');await click(page,'[data-test=sketch-edit-apply]')
 const d=await state(),made=d.sketch.entities.at(-1)
 console.log('duplicate X mm',made.a[0]-a[0]);check(Math.abs(made.a[0]-a[0]-25.4)<1e-6,'Duplicate 1 inch moves geometry by 25.4 mm')
 await re(async()=>{(await import('/src/state/prefsStore.ts')).usePrefs.getState().setUnits('mm')})
})
writeFileSync(shotPath('refinement.json'),JSON.stringify({evidence,consoleErrors},null,2))
await finish(browser,consoleErrors)
