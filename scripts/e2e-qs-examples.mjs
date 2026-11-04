// SPDX-License-Identifier: AGPL-3.0-only
import {readFileSync} from 'node:fs'
import {launchApp,check,fail,finish,shotPath,sleep} from './e2e-lib.mjs'
const bundled=JSON.parse(readFileSync(new URL('../src/app/bundledExamples.json',import.meta.url),'utf8'))
const local=JSON.parse(readFileSync(new URL('../src/app/referenceExamples.json',import.meta.url),'utf8'))
const {browser,page,consoleErrors}=await launchApp({agentDataOk:false,protocolTimeout:180000})
page.on('dialog',dialog=>dialog.accept())
try{
 await page.click('[data-test=ribbon-tab-help]')
 await page.click('[data-test=examples-menu] summary')
 const visible=await page.$$eval('[data-test=examples-menu] [role=menuitem]',els=>els.map(e=>e.textContent))
 const catalog=[...bundled,...local.filter(i=>visible.includes(i.label))]
 check(JSON.stringify(await page.$$eval('[data-test=examples-menu] [role=menuitem]',els=>els.map(e=>e.textContent)))===JSON.stringify(catalog.map(i=>i.label)),'Help > Examples lists bundled and available local parts in order')
 await page.screenshot({path:shotPath('help-examples-menu.png')})
 const layout=await page.$eval('[data-test=examples-menu] .ribbon-menu',menu=>{const r=menu.getBoundingClientRect(),items=[...menu.querySelectorAll('button')].map(e=>e.getBoundingClientRect());return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&items.every((b,i)=>!i||b.top>=items[i-1].bottom)})
 check(layout,'all ten menu entries are visible and do not overlap')
 await page.keyboard.press('Escape')
 check(!await page.$eval('[data-test=examples-menu]',e=>e.open),'Escape dismisses the examples menu')
 for(const item of catalog){
  await page.click('[data-test=examples-menu] summary');await page.click(`[data-test=example-${item.id}]`)
  await page.waitForFunction(name=>{const s=window.__scanruler.measure.getState();return s.fileName===name&&!s.busy&&s.triangleCount>0},{timeout:120000},item.file)
  const state=await page.evaluate(()=>{const s=window.__scanruler.measure.getState();return {file:s.fileName,triangles:s.triangleCount,vertices:s.vertexCount,error:s.errorText}})
  check(state.triangles===item.triangles&&!state.error,`${item.label}: exact file opens with ${item.triangles} reference triangles`)
  check(!await page.$eval('[data-test=examples-menu]',e=>e.open),`${item.label}: menu closes after opening`)
 }
 await page.screenshot({path:shotPath('qs-practice-loaded.png')})
 const before=await page.evaluate(()=>window.__scanruler.measure.getState().fileName)
 await page.setRequestInterception(true)
 page.on('request',request=>request.url().includes('/samples/datum-block.stl')?request.respond({status:200,body:'wrong bytes',contentType:'model/stl'}):request.continue())
 await page.click('[data-test=examples-menu] summary');await page.click('[data-test=example-datum-block]');await sleep(400)
 check(await page.evaluate(()=>window.__scanruler.measure.getState().errorText?.includes('does not match')),'incorrect example bytes show an integrity error')
 check(await page.evaluate(()=>window.__scanruler.measure.getState().fileName)===before,'failed example fetch preserves the current model')
}catch(error){fail(error.stack??String(error))}
finally{await finish(browser,consoleErrors)}
