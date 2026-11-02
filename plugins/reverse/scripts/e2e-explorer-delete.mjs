// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { launchApp, check, finish } from '../../../scripts/e2e-lib.mjs'
import { openReverse } from './lib.mjs'
const { browser, page, consoleErrors } = await launchApp({ protocolTimeout: 180000 })
const out = resolve('../explorer-delete-035'); mkdirSync(out,{recursive:true})
const results=[]
const record=(ok,label)=>{check(ok,label);results.push({ok:!!ok,label})}
try {
  const bytes=[...readFileSync(resolve('../explorer-access-034/basic_part.scanruler'))]
  await page.evaluate(data=>{const t=new DataTransfer();t.items.add(new File([new Uint8Array(data)],'tree-test.scanruler'));window.dispatchEvent(new DragEvent('drop',{dataTransfer:t,bubbles:true,cancelable:true}))},bytes)
  await openReverse(page)
  await page.waitForFunction(()=>window.__re.store.getState().features.some(f=>f.kind==='sketch'))
  const id=await page.evaluate(()=>window.__re.store.getState().features.find(f=>f.kind==='sketch').id)
  const row=place=>`[data-test="explorer-${place}-feature-${id}"]`
  const request=async place=>{await page.click(row(place),{button:'right'});await page.click('[data-test="explorer-delete"]');await page.waitForSelector('[data-test="explorer-delete-confirm"]')}
  await request('object')
  record(await page.$eval('[data-test="explorer-delete-confirm"]',e=>e.textContent.includes('Tree verification sketch')&&e.textContent.includes('Are you sure')), 'confirmation identifies the clicked sketch and asks before deleting')
  await page.keyboard.press('Tab')
  record(await page.evaluate(()=>document.activeElement?.getAttribute('data-test')==='explorer-delete-no'),'Tab moves to No inside the confirmation')
  await page.keyboard.press('Tab')
  record(await page.evaluate(()=>document.activeElement?.getAttribute('data-test')==='explorer-delete-yes'),'Tab stays inside the confirmation instead of reaching background tools')
  await page.click('[data-test="explorer-delete-no"]')
  record(await page.evaluate(id=>window.__re.store.getState().features.some(f=>f.id===id),id), 'No preserves the feature')
  await request('history')
  await page.keyboard.press('Escape')
  record(await page.$('[data-test="explorer-delete-confirm"]')===null,'Escape cancels confirmation')
  await page.click(row('history'))
  await page.keyboard.press('Delete')
  await page.waitForSelector('[data-test="explorer-delete-confirm"]')
  record(true,'Delete key on a focused History row opens confirmation')
  await page.click('[data-test="explorer-delete-yes"]')
  await page.waitForFunction(id=>!window.__re.store.getState().features.some(f=>f.id===id),{},id)
  record(await page.$(row('object'))===null&&await page.$(row('history'))===null,'confirmed deletion removes the same feature from both trees')
  await page.click('[data-test="undo"]')
  await page.waitForSelector(row('object'))
  await page.evaluate(async()=>{const { useMeshTools }=await import('/plugins/mesh-tools/state/meshStore.ts');useMeshTools.getState().setEditing(true)})
  record(await page.$eval(row('object'),e=>e.disabled),'tree actions disable when the mesh session reports an edit in progress')
  await page.evaluate(async()=>{const { useMeshTools }=await import('/plugins/mesh-tools/state/meshStore.ts');useMeshTools.getState().setEditing(false)})
  await page.waitForSelector(`${row('object')}:not([disabled])`)
  record(await page.evaluate(id=>{const f=window.__re.store.getState().features.find(f=>f.id===id);return f?.name==='Tree verification sketch'&&f.sketch.entities.length===4&&f.visible},id),'Undo restores identity, four curves, name and visibility')
  await page.click('[data-test="redo"]')
  await page.waitForFunction(id=>!window.__re.store.getState().features.some(f=>f.id===id),{},id)
  record(await page.$(row('history'))===null,'Redo repeats deletion')
  const cdp = await page.createCDPSession()
  await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:out})
  await page.click('[data-test="save-project"]')
  for(let n=0;n<120&&!readdirSync(out).some(f=>f.endsWith('.scanruler'));n++)await new Promise(r=>setTimeout(r,250))
  const saved=readdirSync(out).find(f=>f.endsWith('.scanruler'))
  if(!saved)throw Error('Deleted-feature project was not saved')
  const reopened=await browser.newPage()
  reopened.on('pageerror',e=>consoleErrors.push(e.message))
  await reopened.goto(process.env.APP_URL??'http://localhost:5173/',{waitUntil:'networkidle0'})
  const savedBytes=[...readFileSync(resolve(out,saved))]
  await reopened.evaluate(data=>{const t=new DataTransfer();t.items.add(new File([new Uint8Array(data)],'deleted-feature.scanruler'));window.dispatchEvent(new DragEvent('drop',{dataTransfer:t,bubbles:true,cancelable:true}))},savedBytes)
  await openReverse(reopened)
  await reopened.waitForFunction(()=>document.body.textContent.includes('Project opened'))
  record(await reopened.evaluate(()=>window.__re.store.getState().features.length===0),'save and reopen keeps the deleted feature absent')
  await reopened.close()
  await page.click('[data-test="undo"]')
  await page.waitForSelector(row('object'))
  // Build a real extrusion so dependency refusal is exercised against an
  // actual downstream feature, not a fabricated dependency flag.
  await page.evaluate(id=>{const s=window.__re.store.getState();s.startExtrude(id);s.commitExtrude()},id)
  await page.waitForFunction(()=>!window.__re.store.getState().building&&window.__re.store.getState().bodies.length>0,{timeout:180000})
  const before=await page.evaluate(()=>window.__re.store.getState().features.length)
  await request('object'); await page.click('[data-test="explorer-delete-yes"]')
  record(await page.evaluate(n=>window.__re.store.getState().features.length===n,before),'sketch with dependent extrusion is preserved without partial deletion')
  record(await page.evaluate(()=>document.body.textContent.includes('built on by a later feature')),'dependency refusal explains which feature cannot be removed')
  await page.screenshot({path:resolve(out,'dependency-refusal.png')})
}catch(error){record(false,error.stack)}
writeFileSync(resolve(out,'results.json'),JSON.stringify(results,null,2))
await finish(browser,consoleErrors)
