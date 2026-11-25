// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict'
import { check, click, finish, launchApp, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { openReverse, reverseHelpers } from './lib.mjs'

const { browser, page, consoleErrors } = await launchApp()
const { re } = reverseHelpers(page)
const at = p => re(p=>window.__re.sheet().sheetScreenPoint(p),p)
const read = () => re(()=> {
  const d=window.__re.store.getState().sketchDraft
  return {sketch:d.sketch, selection:d.selection, ok:d.report.ok, error:d.error}
})
const near=(p,q,tol=0.035)=> Math.hypot(p[0]-q[0],p[1]-q[1]) < tol
try {
  await openReverse(page)
  if(await page.$('[data-test=support-card] .sc-x')) await click(page,'[data-test=support-card] .sc-x')
  for (const fitted of [false,true]) {
    // A horizontal side joined to an oblique one, a driven length and a
    // separate construction line. The fitted variant adds scan samples.
    await re(async fitted=>{
      const shell=await import('/src/state/shellStore.ts')
      shell.useShell.getState().setInspectorMode('docked')
      const s=window.__re.store.getState()
      const entities=[{id:1,kind:'line',a:[-9,3],b:[-2,3]}, {id:2,kind:'line',a:[-2,3],b:[3,6]}, {id:3,kind:'line',a:[2,-4],b:[8,-4],construction:true,fixed:true}]
      if(fitted) for(const e of entities.slice(0,2)) e.points=Array.from({length:21},(_,i)=>e.a.map((x,j)=>x+(e.b[j]-x)*i/20))
      const constraints=[{id:4,kind:'horizontal',entity:1},{id:5,kind:'coincident',p:{entity:1,at:'b'},q:{entity:2,at:'a'}},{id:6,kind:'length',entity:1,value:7,driven:true}]
      s.startSketch({kind:'world',axis:'z',offset:0},{origin:[0,0,0],normal:[0,0,1],basisU:[1,0,0],basisV:[0,1,0]})
      s.setSketch({entities,constraints,nextId:7},undefined,true)
      if (fitted) {
        const part=id=>({id,from:'a',to:'b'})
        window.__re.store.setState(({sketchDraft})=>({sketchDraft:{...sketchDraft,fitted:{
          0:{order:[part(1)],closed:false}, 1:{order:[],closed:false,runs:[[part(2)]],bridges:[1]}
        }}}))
      }
    },fitted)
    await click(page,'[data-test=sketch-tool-select]')
    const start=await at([-2,3])
    await page.mouse.click(start.x,start.y)
    assert((await read()).selection.length===1)
    await page.mouse.move(start.x,start.y); await page.mouse.down()
    for(const point of [[1,1],[5,-4]]) {
      const p=await at(point)
      await page.mouse.move(p.x,p.y,{steps:45}); await sleep(150)
      const live=await read(), [a,b]=live.sketch.entities
      console.log('held',fitted,point,a.b,b.a,'status',live.error)
      check(near(a.b,point,0.10) && near(b.a,point,0.10),`both ends follow while held (fit=${fitted}, target=${point})`)
      check(Math.abs(a.a[1]-a.b[1])<1e-4 && Math.abs(live.sketch.constraints.find(c=>c.id===6).value - Math.hypot(a.b[0]-a.a[0],a.b[1]-a.a[1]))<1e-4,'horizontal relation and driven length update in the live geometry')
    }
    await page.mouse.up(); await sleep(180)
    const result=await read(), [a,b]=result.sketch.entities
    const mid=c=> c.kind==='coincident' && [c.p,c.q].some(p=>p.entity===3 && p.at==='center')
    check(result.ok && !result.error && near(a.b,[5,-4]) && near(b.a,[5,-4]) && result.sketch.constraints.some(mid),'release adds a persistent midpoint coincidence and keeps the original joint')
    if(fitted) {
      await page.screenshot({path:shotPath('fitted-vertex.png')})
      const links=()=>re(()=>window.__re.store.getState().sketchDraft.fitted)
      const after=await links()
      assert.deepEqual([after[0].order,after[1].runs,after[1].bridges],[[],[],[]])
      await page.keyboard.down('Control');await page.keyboard.press('z');await page.keyboard.up('Control')
      const before=await links()
      assert.deepEqual([before[0].order[0].id,before[1].runs[0][0].id,before[1].bridges[0]],[1,2,1])
      await page.keyboard.down('Control');await page.keyboard.press('y');await page.keyboard.up('Control')
      assert.deepEqual(await links(),after)
      console.log('PASS: fitted chain membership and linked runs return on Undo and detach on Redo')
    }
  }
} catch(error) { check(false,error.stack) }
await finish(browser,consoleErrors)
