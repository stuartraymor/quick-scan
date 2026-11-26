// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict'
import { click, check, finish, launchApp, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { openReverse, reverseHelpers } from './lib.mjs'

const { browser, page, consoleErrors } = await launchApp()
const { re } = reverseHelpers(page)
const tool = id => click(page, `[data-test=${id}]`)
const pixel = point => re(p=>window.__re.sheet().sheetScreenPoint(p),point)
const state = () => re(()=> {
  const d=window.__re.store.getState().sketchDraft
  return {pending:d.pending, count:d.sketch.entities.length, error:d.error}
})
try {
  await openReverse(page)
  if (await page.$('[data-test=support-card] .sc-x')) await click(page,'[data-test=support-card] .sc-x')
  // Fixture only. Place an existing dimension on a line, finish the sketch,
  // and enter the editor from the actual History row.
  await re(async () => {
    const shell=await import('/src/state/shellStore.ts')
    shell.useShell.getState().setInspectorMode('docked')
    const s=window.__re.store.getState()
    s.startSketch({kind:'world',axis:'z',offset:0},{origin:[0,0,0],normal:[0,0,1],basisU:[1,0,0],basisV:[0,1,0]},[{kind:'line',a:[-7,-1],b:[7,-1]}])
    const d=window.__re.store.getState().sketchDraft
    s.setSketch({...d.sketch,constraints:[{kind:'length',entity:d.sketch.entities[0].id,value:14,id:2}],nextId:3})
  })
  await click(page,'[data-test=sketch-ok-cancel] button.primary')
  const id=await re(()=>window.__re.store.getState().features.find(f=>f.kind==='sketch').id)
  await page.click(`[data-test="explorer-history-feature-${id}"]`,{count:2})
  await page.waitForSelector('[data-test=flat-dimension-2]')
  const dim=await (await page.$('[data-test=flat-dimension-2]')).boundingBox()
  const label={x:dim.x+dim.width/2,y:dim.y+dim.height/2}
  for(const [where,first] of [['empty sheet',await pixel([2,3])],['line endpoint',await pixel([-7,-1])],['dimension label',label]]) {
    await tool('sketch-tool-rectangle')
    await page.mouse.click(first.x,first.y)
    const started=await state()
    check(started.pending.length===1,`one click starts Rectangle over ${where} (pending ${started.pending.length})`)
    if(started.pending.length===1) {
      const other=await pixel([5,-4]); await page.mouse.move(other.x,other.y); await sleep(100)
      if(where==='dimension label') await page.screenshot({path:shotPath('rectangle-preview.png')})
      await page.mouse.click(other.x,other.y)
      assert.equal((await state()).count,started.count+4)
      await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control')
    }
    await page.keyboard.press('Escape')
  }
  await tool('sketch-tool-rectangle')
  const p=await pixel([2,3])
  await page.mouse.click(p.x,p.y,{count:2})
  const twice=await state()
  check(twice.pending.length===1 && twice.count===1,'an extra click at the first corner keeps the rectangle in progress')
  await page.keyboard.press('Escape'); await tool('sketch-tool-select')
  await page.mouse.click(label.x,label.y,{count:2})
  await page.waitForSelector('[data-test=flat-dimension-2] input',{timeout:3000})
  console.log('PASS: Modify still edits an existing dimension by double-click')
} catch(error) { check(false,error.stack) }
await finish(browser,consoleErrors)
