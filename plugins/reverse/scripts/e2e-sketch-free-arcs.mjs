// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict'
import { check, click, finish, launchApp, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { openReverse, reverseHelpers } from './lib.mjs'

const {browser,page,consoleErrors} = await launchApp()
const {re} = reverseHelpers(page)
const at = p => re(p=>window.__re.sheet().sheetScreenPoint(p),p)
const point = async p => { const q=await at(p); await page.mouse.click(q.x,q.y); await sleep(120) }
const move = async p => { const q=await at(p); await page.mouse.move(q.x,q.y); await sleep(150) }
const key = test => click(page,`[data-test=${test}]`)
const draft = ()=>re(()=>window.__re.store.getState().sketchDraft.sketch)
try {
  await openReverse(page)
  if(await page.$('[data-test=support-card] .sc-x')) await click(page,'[data-test=support-card] .sc-x')
  await re(async()=>{
    const shell=await import('/src/state/shellStore.ts')
    shell.useShell.getState().setInspectorMode('docked')
    window.__re.store.getState().startSketch({kind:'world',axis:'z',offset:0},{origin:[0,0,0],normal:[0,0,1],basisU:[1,0,0],basisV:[0,1,0]})
  })
  await page.waitForSelector('[data-test=sketch-tool-arc]')
  await re(()=>{
    const v=window.__re.sheet(), save=v.setFlatDots.bind(v)
    v.setFlatDots=dots=>{window.__arcDots=dots;return save(dots)}
  })
  await key('sketch-tool-arc')
  await point([-5,2]); await point([4,2]); await point([-3,5])
  await move([8,-3])
  const [arc]=(await draft()).entities
  assert.equal(arc?.kind,'arc')
  const theta=arc.start + arc.sweep*(arc.gripT??0.5)
  const through=[arc.c[0]+arc.r*Math.cos(theta),arc.c[1]+arc.r*Math.sin(theta)]
  check(Math.hypot(through[0]+3,through[1]-5)<0.08,'the grip stays at the actual third click')
  const dots=await re(()=>window.__arcDots.filter(d=>d.shape==='square' && d.color==='#62aae4'))
  console.log('Idle blue squares',dots.map(d=>d.at),'through grip',through)
  check(dots.length===0,'idle arc has no floating blue snap squares')
  await page.screenshot({path:shotPath('three-point-arc.png')})
  await key('sketch-tool-tangent-arc'); await point([-6,-4]); await point([-3,-4])
  await move([-3,-1]); await page.waitForFunction(()=>document.querySelector('[data-test=sketch-extra-overlay] path[stroke="#009c42"]')?.getAttribute('d')?.length>10)
  assert.equal((await draft()).entities.length,1)
  await page.screenshot({path:shotPath('free-tangent-preview.png')})
  await point([-3,-1])
  const list=(await draft()).entities
  assert.equal(list.length,2)
  check(list[1].kind==='arc' && Math.hypot(list[1].c[0]+6,list[1].c[1]+1)<0.09 && Math.abs(list[1].r-3)<0.08,'free-start arc uses the indicated tangent and the chosen endpoint')
  await point([5,-3]); await page.keyboard.press('Escape')
  assert.equal((await draft()).entities.length,2)
  await page.keyboard.down('Control');await page.keyboard.press('z');await page.keyboard.up('Control')
  assert.equal((await draft()).entities.length,1)
  await page.keyboard.down('Control');await page.keyboard.press('y');await page.keyboard.up('Control')
  assert.equal((await draft()).entities.length,2)
  console.log('PASS: partial arc cancels, completed arc undoes and redoes as one edit')
} catch(error) {check(false,error.stack)}
await finish(browser,consoleErrors)
