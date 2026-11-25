// SPDX-License-Identifier: AGPL-3.0-only
// Blank fixture setup uses the DEV bridge; every drawing, relation, glyph,
// removal and undo action under test uses the visible mouse/keyboard route.
import {check,click,finish,launchApp,shotPath,sleep} from '../../../scripts/e2e-lib.mjs'
import {openReverse,reverseHelpers} from './lib.mjs'
const {browser,page,consoleErrors}=await launchApp({width:1500,height:960,protocolTimeout:600000})
const {re}=reverseHelpers(page),frame={origin:[0,0,0],normal:[0,0,1],basisU:[1,0,0],basisV:[0,1,0]}
const state=()=>re(()=>window.__re.store.getState().sketchDraft)
const pick=async p=>{const q=await re(p=>window.__re.sheet().sheetScreenPoint(p),p);await page.mouse.move(q.x,q.y);await page.mouse.click(q.x,q.y);await sleep(120)}
const mid=e=>[(e.a[0]+e.b[0])/2,(e.a[1]+e.b[1])/2]
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])
const undo=async()=>{await page.keyboard.down('Control');await page.keyboard.press('z');await page.keyboard.up('Control');await sleep(200)}
try{
 await openReverse(page)
 if(await page.$('[data-test=support-card] .sc-x'))await click(page,'[data-test=support-card] .sc-x')
 await re(async()=>{(await import('/src/state/shellStore.ts')).useShell.getState().setInspectorMode('docked')})
 for(const variant of ['horizontal','vertical','oblique']){
  await re(f=>window.__re.store.getState().startSketch({kind:'world',axis:'z',offset:0},f),frame)
  await sleep(350)
  const points=await re(kind=>{
   const r=document.querySelector('[data-test=sketch-viewport] canvas').getBoundingClientRect(),v=window.__re.sheet()
   const at=(x,y)=>v.sheetPoint(r.left+r.width*x,r.top+r.height*y)
   return [at(.57,.3),at(kind==='vertical'?.57:.85,kind==='horizontal'?.3:.45),at(.63,.62),at(.8,.76)]
  },variant)
  await click(page,'[data-test=sketch-tool-line]')
  for(const p of points)await pick(p)
  await page.keyboard.press('Escape');await click(page,'[data-test=sketch-tool-select]')
  let d=await state(),lines=d.sketch.entities.filter(e=>e.kind==='line')
  check(lines.length===2,`${variant}: two unequal lines drawn with the mouse`)
  if(lines.length!==2)throw Error('Expected two lines')
  const before=structuredClone(d.sketch),a=mid(lines[0]),b=mid(lines[1])
  await click(page,'[data-test=sketch-rel-coincident]')
  await pick(a)
  d=await state()
  check((d.relPicks?.[0]?.anchor??d.relPicks?.[0]?.via)?.at==='center',`${variant}: the first pick retains the midpoint anchor`)
  await pick(b);d=await state();lines=d.sketch.entities.filter(e=>e.kind==='line')
  const c=d.sketch.constraints.find(c=>c.kind==='coincident'&&c.p.at==='center'&&c.q.at==='center')
  check(!!c&&!d.error,`${variant}: Coincident creates a midpoint-to-midpoint relation (${d.error??'no error'})`)
  check(distance(mid(lines[0]),mid(lines[1]))<1e-6,`${variant}: independent endpoint arithmetic confirms common midpoints to 1e-6 mm`)
  await page.keyboard.press('Escape');await click(page,'[data-test=sketch-tool-select]');await sleep(200)
  if(!c)continue
  const selector=`[data-test=flat-note-${c.id}]`
  await page.waitForSelector(selector,{visible:true})
  const box=await page.$eval(selector,e=>{const r=e.getBoundingClientRect();const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{x:r.x+r.width/2,y:r.y+r.height/2,hit:e.contains(top),title:e.title}})
  check(box.hit,`${variant}: the on-line Coincident glyph is reachable by the mouse`)
  await page.mouse.move(box.x,box.y);await page.mouse.click(box.x,box.y);await sleep(200)
  check((await state()).selectedConstraint===c.id,`${variant}: clicking the glyph selects its actual constraint`)
  await page.screenshot({path:shotPath(`midpoint-glyph-${variant}.png`)})
  await click(page,'[data-test=sketch-relation-row].sel button.x');await sleep(150)
  check(!(await state()).sketch.constraints.some(x=>x.id===c.id),`${variant}: the selected relation can be removed in the inspector`)
  await undo()
  check((await state()).sketch.constraints.some(x=>x.id===c.id),`${variant}: Undo restores the midpoint relation`)
  await undo()
  check(JSON.stringify((await state()).sketch)===JSON.stringify(before),`${variant}: another Undo restores exact pre-relation geometry`)
 }
}catch(e){check(false,e.stack??String(e))}finally{await finish(browser,consoleErrors)}
