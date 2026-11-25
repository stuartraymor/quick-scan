// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict'
import { check, click, finish, launchApp, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { openReverse, reverseHelpers } from './lib.mjs'

const {browser,page,consoleErrors}=await launchApp()
const {re}=reverseHelpers(page)
const key=id=>click(page,`[data-test=${id}]`)
const at=p=>re(p=>window.__re.sheet().sheetScreenPoint(p),p)
const state=()=>re(()=>window.__re.store.getState().sketchDraft)
const near=(a,b)=>Math.abs(a-b)<1e-5
const shortcut=async k=>{await page.keyboard.down('Control');await page.keyboard.press(k);await page.keyboard.up('Control');await sleep(180)}
async function seed(entities,constraints=[]) {
  await re(async ({entities,constraints})=>{
    const shell=await import('/src/state/shellStore.ts');shell.useShell.getState().setInspectorMode('docked')
    const s=window.__re.store.getState()
    s.startSketch({kind:'world',axis:'z',offset:0},{origin:[0,0,0],normal:[0,0,1],basisU:[1,0,0],basisV:[0,1,0]})
    s.setSketch({entities,constraints,nextId:50},undefined,true)
  },{entities,constraints})
  await key('sketch-tool-select')
}
const line=(id,a,b)=>({id,kind:'line',a,b})
try {
  await openReverse(page)
  if(await page.$('[data-test=support-card] .sc-x')) await click(page,'[data-test=support-card] .sc-x')
  await seed([line(1,[-6,3],[6,3]),line(2,[-2,1],[-2,5]),line(3,[2,1],[2,5]),line(4,[-4,-2],[4,-2])])
  await key('sketch-trim')
  const history=(await state()).history.length, before=(await state()).sketch
  const from=await at([0,6]), to=await at([0,-4])
  await page.mouse.move(from.x,from.y);await page.mouse.down()
  await page.mouse.move(to.x,to.y);await sleep(120)
  const trail='[data-test=sketch-extra-overlay] path[stroke="#df3434"]'
  assert((await page.$eval(trail,e=>e.getAttribute('d')))?.includes('L'))
  assert.deepEqual((await state()).sketch,before)
  await page.screenshot({path:shotPath('trim-stroke.png')})
  await page.mouse.up();await sleep(150)
  assert.equal(await page.$eval(trail,e=>e.getAttribute('d')),'')
  let d=await state()
  assert.equal(d.history.length,history+1)
  const spans=d.sketch.entities.filter(e=>e.kind==='line' && near(e.a[1],3) && near(e.b[1],3)).map(e=>[e.a[0],e.b[0]])
  assert.deepEqual(spans,[[-6,-2],[2,6]])
  assert(!d.sketch.entities.some(e=>e.id===4))
  await shortcut('z');assert.deepEqual((await state()).sketch,before)
  await shortcut('y');assert.deepEqual((await state()).sketch,d.sketch)
  console.log('PASS: one fast Trim stroke, red trail cleared, middle span trimmed, isolated line deleted, Undo and Redo exact')
  await seed([{id:1,kind:'spline',pts:[[-4,0],[-2,2],[0,0],[2,-2],[4,0]]},line(2,[-2,-3],[-2,3]),line(3,[2,-3],[2,3])])
  await key('sketch-trim')
  const splineFrom=await at([0,-1]), splineTo=await at([0,1])
  await page.mouse.move(splineFrom.x,splineFrom.y);await page.mouse.down()
  await page.mouse.move(splineTo.x,splineTo.y);await page.mouse.up();await sleep(180)
  const trimmed=(await state()).sketch
  assert.equal(trimmed.entities.filter(e=>e.kind==='spline' && e.controlKnots).length,2)
  assert.equal(trimmed.constraints.filter(c=>c.kind==='pointOn').length,2)
  console.log('PASS: a mouse stroke trimmed the middle of a spline into two exact constrained spline spans')

  for(const sizeLocked of [false,true]) {
    const c={id:1,kind:'circle',c:[-2,1],r:2}, dim={id:4,kind:'diameter',entity:1,value:4}
    await seed([c],sizeLocked?[dim]:[])
    const pick=await at([-2,1]), start=await at([0,1]), end=await at([2,1])
    await page.mouse.click(pick.x,pick.y)
    assert.deepEqual((await state()).selection,[1])
    await page.mouse.move(start.x,start.y);await page.mouse.down()
    await page.mouse.move(end.x,end.y,{steps:15});await sleep(140)
    const live=(await state()).sketch.entities[0]
    await page.mouse.up();await sleep(120)
    const saved=(await state()).sketch.entities[0]
    for(const circle of [live,saved]) {
      assert(Math.hypot(circle.c[0]+2,circle.c[1]-1)<.03)
      assert(Math.abs(circle.r-(sizeLocked?2:4))<.04)
    }
    console.log('PASS: circle quadrant drag kept its center, diameter was',sizeLocked?'held by the driving dimension':'updated live')
  }
  await seed([{id:1,kind:'circle',c:[-4,3],r:2},line(2,[2,2],[5,5])])
  const acquire=async (p,dx,dy)=>{
    const pixel=await at(p);await page.mouse.move(pixel.x+dx,pixel.y+dy);await sleep(140);await page.mouse.click(pixel.x+dx,pixel.y+dy);await sleep(120)
    const d=await state();return d.dimPick?.anchor??d.dimPick?.via
  }
  for(const [p,id,anchor,dx,dy] of [[[-4,3],1,'center',0,7],[[-2,3],1,'q0',0,7],[[2,2],2,'a',-7,0],[[3.5,3.5],2,'center',0,7]]) {
    await key('sketch-tool-select');await key('sketch-dimension')
    const pick=await acquire(p,dx,dy)
    assert.deepEqual(pick,{entity:id,at:anchor})
    console.log('PASS: Dimension acquired',anchor,'from seven pixels away')
    if(anchor==='center' && id===1){
      await acquire([5,5],7,0)
      const c=(await state()).sketch.constraints.find(c=>c.kind==='distance')
      assert(c?.p.at==='center' && c.q.at==='b')
      await page.screenshot({path:shotPath('dimension-picks.png')})
    }
    await page.keyboard.press('Escape')
  }
  await key('sketch-tool-select');await key('sketch-dimension')
  await key('toggle-inspector-dock')
  try {
    for(const width of [1280,960]) {
      await page.setViewport({width,height:720});await sleep(180)
      const covered=await page.$$eval('[data-test=snap-bar] button', buttons=>buttons.filter(button=>{
        const rect=button.getBoundingClientRect()
        return !button.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2))
      }).map(button=>button.dataset.test))
      assert.deepEqual(covered,[])
    }
    await key('snap-center');await key('snap-center')
    console.log('PASS: every Dimension pick switch receives the mouse with a floating inspector at 1280 and 960 pixels')
  } finally {
    await key('toggle-inspector-dock')
    await page.setViewport({width:1440,height:900})
  }
  await seed([line(1,[-5,-3],[0,2]),line(2,[0,2],[4,4])],[{id:3,kind:'coincident',p:{entity:1,at:'b'},q:{entity:2,at:'a'}}])
  const button='[data-test=sketch-rel-coincident] svg path', note='.viewport-label.glyph.coincident svg path'
  await page.waitForSelector(note)
  const icon=await page.$eval(button,e=>({d:e.getAttribute('d'), fill:getComputedStyle(e).fill}))
  const glyph=await page.$eval(note,e=>({d:e.getAttribute('d'), fill:getComputedStyle(e).fill}))
  assert.equal(icon.d,glyph.d);assert.notEqual(icon.fill,'none');assert.notEqual(glyph.fill,'none')
  assert(await page.$('[data-test=sketch-tool-slot] [stroke-dasharray]'))
  assert.equal(await page.$$eval('[data-test=sketch-tool-polygon] circle',es=>es.length),0)
  await (await page.$('[data-test=sketch-editor] .sketch-controls')).screenshot({path:shotPath('edit-sketch-icons.png')})
  await (await page.$('.viewport-label.glyph.coincident')).screenshot({path:shotPath('coincident-viewport.png')})
  console.log('PASS: solid Coincident dot on the same horizontal line in the viewport and sketch controls, dotted Slot and Hexagon visible')
} catch(error){check(false,error.stack)}
await finish(browser,consoleErrors)
