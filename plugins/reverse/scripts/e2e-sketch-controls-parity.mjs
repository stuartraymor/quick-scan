// SPDX-License-Identifier: AGPL-3.0-only
// Current Quick Scan toolbar regression, not certification of native control parity.
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
// Ctrl+click adds to a sketch selection, as in QUICKSURFACE; a plain click replaces it.
const pickAdd=async(p)=>{await page.keyboard.down('Control');try{await pick(p)}finally{await page.keyboard.up('Control')}}
const move=async(p)=>{const [x,y]=await client(p);await page.mouse.move(x,y);await sleep(100)}
const safe=async()=>re(()=>{const r=document.querySelector('[data-test=sketch-viewport]').getBoundingClientRect();const s=window.__re.sheet();const left=Math.max(r.left+380,r.left+r.width*.57), top=r.top+r.height*.45;return [[left,top],[left+100,top],[left+100,top-80],[left+40,top+75]].map(([x,y])=>s.sheetPoint(x,y))})
const undo=async()=>{await page.keyboard.down('Control');await page.keyboard.press('z');await page.keyboard.up('Control');await sleep(180)}
await openReverse(page)
if(await page.$('[data-test=support-card] .sc-x'))await click(page,'[data-test=support-card] .sc-x')
await seed()
const groups={
 'sketch-tools':['sketch-tool-line','sketch-tool-polyline','sketch-tool-circle-three','sketch-tool-circle','sketch-tool-tangent-arc','sketch-tool-arc','sketch-tool-spline','sketch-tool-middle','sketch-tool-rectangle','sketch-tool-slot','sketch-tool-polygon'],
 'sketch-edit':['sketch-tool-select','sketch-join','sketch-sharpen','sketch-trim','sketch-dimension','sketch-mirror','sketch-duplicate','sketch-offset-entities','sketch-tool-fillet','sketch-tool-project'],
 'sketch-relations':['sketch-construction','sketch-fix','sketch-rel-horizontal','sketch-rel-vertical','sketch-rel-tangent','sketch-rel-collinear','sketch-rel-equal','sketch-rel-parallel','sketch-rel-perpendicular','sketch-rel-symmetric'],
}
await test('ordered-command-rows',async()=>{
 for(const [width,height]of [[1500,960],[1000,720]]){
  await page.setViewport({width,height});await sleep(250)
  for(const [id,expected]of Object.entries(groups)){
   const row=await page.$$eval(`[data-test=${id}] > button`,es=>es.map(e=>({id:e.dataset.test,x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,w:e.getBoundingClientRect().width})))
   check(JSON.stringify(row.map(e=>e.id))===JSON.stringify(expected),`${width}: ${id} has exact ordered ${expected.length} controls`)
   check(row.every(e=>Math.abs(e.y-row[0].y)<1)&&row.every((e,i)=>!i||e.x>=row[i-1].x+row[i-1].w),`${width}: ${id} stays in one aligned nonoverlapping row`)
  }
  await page.screenshot({path:shotPath(`sketch-controls-${width}x${height}.png`)})
 }
 await page.setViewport({width:1500,height:960});await sleep(200)
})
await test('graphical-slot',async()=>{
 await seed();const [a,b,,w]=await safe()
 await click(page,'[data-test=sketch-tool-slot]');await pick(a);await pick(b);await move(w)
 check(await page.$eval('[data-test=sketch-extra-overlay] path[stroke="#009c42"]',e=>Boolean(e.getAttribute('d'))),'slot has live complete green ghost before commit')
 await page.screenshot({path:shotPath('sketch-slot-ghost.png')})
 await pick(w);const d=await state()
 check(d.sketch.entities.filter(e=>e.kind==='line').length===2&&d.sketch.entities.filter(e=>e.kind==='arc').length===2&&d.found.length===1,'three graphical slot picks commit two sides, two arcs and a closed region')
 await page.keyboard.press('Escape');check(await page.$('[data-test=sketch-extra-overlay]')===null,'Escape puts extra tool down preserving committed slot')
 check((await state()).sketch.entities.length===4,'slot geometry remains after Escape')
 await page.screenshot({path:shotPath('sketch-slot-committed.png')})
})
await test('line-and-polyline',async()=>{
 await seed();let [a,b,c]=await safe();await click(page,'[data-test=sketch-tool-line]');await pick(a);await pick(b);await pick(c)
 check((await state()).sketch.entities.length===1,'Line finishes one segment after two picks; third starts a fresh segment')
 await seed();[a,b,c]=await safe();await click(page,'[data-test=sketch-tool-polyline]');await pick(a);await pick(b);await pick(c)
 check((await state()).sketch.entities.length===2,'Polyline carries on with two segments after three picks')
 await page.keyboard.press('Escape')
})
await test('graphical-line-drag',async()=>{
 await seed();let [a,b,c]=await safe();await click(page,'[data-test=sketch-tool-line]')
 let [x0,y0]=await client(a),[x1,y1]=await client(b)
 await page.mouse.move(x0,y0);await page.mouse.down();await page.mouse.move(x1,y1,{steps:10});await page.mouse.up();await sleep(200)
 let d=await state();check(d.sketch.entities.length===1&&d.pending.length===0,'graphical Line drag creates one segment and ends the chain')
 await seed();[a,b,c]=await safe();await click(page,'[data-test=sketch-tool-polyline]');[x0,y0]=await client(a);[x1,y1]=await client(b)
 await page.mouse.move(x0,y0);await page.mouse.down();await page.mouse.move(x1,y1,{steps:10});await page.mouse.up();await sleep(200);await pick(c)
 d=await state();check(d.sketch.entities.length===2,'graphical Polyline drag leaves the next segment ready to continue')
 await page.keyboard.press('Escape')
})
await test('multi-selection-and-context',async()=>{
 await seed();const [a,b,c]=await safe(), dx=(b[0]-a[0]), dy=(c[1]-a[1])
 const lines=[0,1,2].map(i=>({kind:'line',a:[a[0]+i*dx*.42,a[1]],b:[a[0]+i*dx*.42+dx*.14,a[1]+dy]}))
 await seed(lines)
 for(const [i,l] of lines.entries())await (i?pickAdd:pick)([(l.a[0]+l.b[0])/2,(l.a[1]+l.b[1])/2])
 check((await state()).selection.length===3,'a click and two Ctrl+clicks select three lines')
 await page.waitForSelector('[data-test=sketch-context-tools]');await sleep(100)
 check(await page.$eval('[data-test=sketch-context-tools]',e=>getComputedStyle(e).visibility==='visible'),'contextual actionable glyph toolbar is visible near selected geometry')
 await click(page,'[data-test=sketch-context-vertical]')
 let d=await state();check(d.sketch.constraints.filter(c=>c.kind==='vertical').length===3,'contextual Vertical applies to all three selected lines')
 check(d.sketch.entities.every(e=>Math.abs(e.a[0]-e.b[0])<1e-4),'vertical constraints dynamically solve actual geometry')
 check(await page.$$eval('.viewport-label.note-label.glyph',es=>es.filter(e=>e.getBoundingClientRect().width>0).length)>0,'applied relation glyphs are visible on actual sheet')
 await click(page,'[data-test=sketch-context-fix]');d=await state()
 check(d.sketch.entities.every(e=>e.fixed),'contextual Fix fixes every selected line')
 await page.screenshot({path:shotPath('sketch-multi-constraints-context.png')})
})
await test('dimension-placement-and-edit',async()=>{
 await seed();const [a,b]=await safe();await seed([{kind:'line',a,b}]);await pick([(a[0]+b[0])/2,a[1]])
 await click(page,'[data-test=sketch-dimension]');const id=(await state()).dimMade
 check(id!=null,'Dimensions on selected line creates a pending length dimension')
 const place=[(a[0]+b[0])/2,a[1]+Math.abs(b[0]-a[0])*.4];await move(place);await pick(place);await sleep(180)
 const selector=`[data-test=flat-dimension-${id}] input`
 await page.waitForSelector(selector,{timeout:7000});await click(page,selector);await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');await page.keyboard.type('12');await page.keyboard.press('Enter');await sleep(220)
 const d=await state(), dim=d.sketch.constraints.find(c=>c.id===id)
 check(dim?.value===12,'dimension placed on canvas accepts typed value')
 const line=d.sketch.entities[0];check(Math.abs(Math.hypot(line.b[0]-line.a[0],line.b[1]-line.a[1])-12)<1e-3,'edited dimension drives real line length')
 await page.screenshot({path:shotPath('sketch-dimension-edited.png')})
})
await test('mirror-duplicate-offset-undo',async()=>{
 await seed();const [a,b,c]=await safe(), span=Math.abs(b[0]-a[0])*.3
 const x=a[0], y=a[1]
 await seed([{kind:'line',a:[x,y],b:[x,y+span*2],construction:true},{kind:'line',a:[x+span,y],b:[x+span*2,y]}])
 await pick([x,y+span]);await pickAdd([x+span*1.5,y]);await click(page,'[data-test=sketch-mirror]')
 let d=await state();check(d.sketch.entities.length===3,'Mirror command creates a real independent copy about selected construction line')
 const made=d.sketch.entities.at(-1);check(made.kind==='line'&&Math.abs(made.a[0]-(x-span))<1e-5,'mirrored line is geometrically reflected')
 await undo();check((await state()).sketch.entities.length===2,'Undo removes the entire mirror operation')
 await click(page,'[data-test=sketch-tool-select]');await pick([x+span*1.5,y]);await click(page,'[data-test=sketch-duplicate]');await click(page,'[data-test=sketch-edit-apply]')
 check((await state()).sketch.entities.length===3,'Duplicate Apply creates actual geometry');await undo();check((await state()).sketch.entities.length===2,'Duplicate is undoable')
 await pick([x+span*1.5,y]);await click(page,'[data-test=sketch-offset-entities]');await click(page,'[data-test=sketch-edit-apply]')
 check((await state()).sketch.entities.length===3,'Offset Apply creates actual shifted geometry');await undo();check((await state()).sketch.entities.length===2,'Offset is undoable')
})
await test('graphical-middle-trim-tangent-navigation',async()=>{
 await seed();const [a,b,c]=await safe(), span=Math.abs(b[0]-a[0])*.45
 const x=a[0],y=a[1]
 await seed([{kind:'line',a:[x,y],b:[x+span*2,y]},{kind:'line',a:[x,y+span],b:[x+span*2,y+span]}])
 await click(page,'[data-test=sketch-tool-middle]');await pick([x+span,y]);await move([x+span,y+span])
 check(await page.$eval('[data-test=sketch-extra-overlay] path[stroke="#009c42"]',e=>Boolean(e.getAttribute('d'))),'middle-line hover previews the midpoint geometry')
 await pick([x+span,y+span]);let d=await state()
 check(d.sketch.entities.length===3&&Math.abs(d.sketch.entities.at(-1).a[1]-(y+span/2))<1e-5,'graphical middle-line picks commit actual midpoint line')
 await page.keyboard.press('Escape')
 await seed([{kind:'line',a:[x,y],b:[x+span*2,y]},{kind:'line',a:[x+span*.6,y-span],b:[x+span*.6,y+span]},{kind:'line',a:[x+span*1.4,y-span],b:[x+span*1.4,y+span]}])
 await click(page,'[data-test=sketch-trim]');await move([x+span,y]);await pick([x+span,y]);d=await state()
 check(d.sketch.entities.length===4&&d.sketch.entities.every(e=>e.id!==1),'graphical Trim removes only middle span and preserves two remaining pieces')
 await page.keyboard.press('Escape')
 await seed([{kind:'line',a:[x,y],b:[x+span,y]},{kind:'line',a:[x+span*2,y+span],b:[x+span*2,y+span*2]}])
 await click(page,'[data-test=sketch-tool-tangent-arc]');await pick([x+span,y]);await move([x+span*2,y+span])
 check(await page.$eval('[data-test=sketch-extra-overlay] path[stroke="#009c42"]',e=>Boolean(e.getAttribute('d'))),'tangent-arc hover previews a real tangent arc')
 await pick([x+span*2,y+span]);d=await state()
 check(d.sketch.entities.some(e=>e.kind==='arc')&&d.sketch.constraints.some(c=>c.kind==='tangent')&&d.report?.ok,'graphical tangent arc commits solved geometry with a tangent equation')
 await page.screenshot({path:shotPath('sketch-extra-tools-tangent.png')})
 const before=await re(()=>window.__re.sheet().sheetView().centre)
 const [px,py]=await client([x+span*2.8,y-span*.8]);await page.mouse.move(px,py);await page.mouse.down({button:'right'});await page.mouse.move(px+40,py+25,{steps:8});await page.mouse.up({button:'right'});await sleep(160)
 const after=await re(()=>window.__re.sheet().sheetView().centre)
 check(Math.hypot(after[0]-before[0],after[1]-before[1])>1e-4,'right-button sheet navigation still works with an extra tool armed')
 await page.keyboard.press('Escape')
})
await test('display-controls',async()=>{
 const before=await re(()=>window.__re.store.getState().sketchSliced)
 await click(page,'[data-test=sketch-clip]');check(await re(()=>window.__re.store.getState().sketchSliced)!==before,'Clip toggles actual sketch slice state')
 await click(page,'[data-test=sketch-normal]');check(await re(()=>window.__re.sheet()!==null),'Normal to sketch preserves actual sheet')
 for(const id of ['sketch-show-control-points','sketch-show-relations','sketch-show-dimensions']){
  const before=await page.$eval(`[data-test=${id}]`,e=>e.checked);await click(page,`[data-test=${id}]`);check(await page.$eval(`[data-test=${id}]`,e=>e.checked)!==before,`${id} toggles checked presentation state`);await click(page,`[data-test=${id}]`)
 }
 await page.screenshot({path:shotPath('sketch-display-final.png')})
})
writeFileSync(shotPath('sketch-controls-evidence.json'),JSON.stringify({evidence,consoleErrors},null,2))
await finish(browser,consoleErrors)
