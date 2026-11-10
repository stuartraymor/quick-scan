// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { launchApp, loadScan, OUT_DIR, shotPath } from '../../../scripts/e2e-lib.mjs'
const n=160,obj=[]
for(const z of [-5,5])for(let i=0;i<n;i++)obj.push(`v ${10*Math.cos(i*Math.PI*2/n)} ${10*Math.sin(i*Math.PI*2/n)} ${z}`)
obj.push('v 0 0 -5','v 0 0 5')
for(let i=0;i<n;i++){const a=i+1,b=(i+1)%n+1,c=a+n,d=b+n;obj.push(`f ${a} ${b} ${d}`,`f ${a} ${d} ${c}`,`f ${2*n+1} ${b} ${a}`,`f ${2*n+2} ${c} ${d}`)}
const fixture=join(OUT_DIR,'workflow-cylinder-r10.obj');writeFileSync(fixture,obj.join('\n'))
assert.equal(createHash('sha256').update(readFileSync(fixture)).digest('hex'),'705a33aed997598451bdab9418796811baaf5dbf3ed75389f02f7bffb6fb04cc')
const downloads=join(OUT_DIR,`downloads-${Date.now()}`);mkdirSync(downloads,{recursive:true})
const {browser,page,consoleErrors}=await launchApp()
const click=s=>page.$eval(s,e=>e.click())
const state=()=>page.evaluate(()=>{const d=window.__re.store.getState().sketchDraft;return {entities:d.sketch.entities,history:d.history.length,frame:d.frame}})
try{
 const cdp=await browser.target().createCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads})
 await loadScan(page,fixture)
 await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='2D Sketch').click())
 await page.waitForSelector('[data-test=place-create]')
 await click('[data-test=place-plane-x]')
 await page.$eval('[data-test=place-offset]',e=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(e,'2');e.dispatchEvent(new Event('input',{bubbles:true}))})
 await click('[data-test=place-offset-apply]');await click('[data-test=place-create]')
 await page.waitForSelector('[data-test=sketch-editor]')
 await page.waitForFunction(()=>!document.querySelector('[data-test=sketch-assist]').disabled)
 const before=await state();assert.equal(before.frame.origin[0],2);assert.equal(before.entities.length,0)
 await click('[data-test=sketch-assist]');await page.waitForSelector('[data-test=sketch-assist-dialog]')
 await page.waitForFunction(()=>!document.querySelector('[data-test=sketch-assist-accept]').disabled)
 assert.ok((await state()).entities.length>0);assert.equal((await state()).history,before.history)
 await page.$eval('[data-test=sketch-assist-dialog]',e=>Array.from(e.querySelectorAll('button')).find(b=>b.textContent==='Options …').click())
 await page.$eval('[aria-label="Assist join corners"]',e=>e.click())
 assert.equal(await page.$eval('[data-test=sketch-assist-accept]',e=>e.disabled),true)
 await click('[data-test=sketch-assist-preview]');await page.waitForFunction(()=>!document.querySelector('[data-test=sketch-assist-accept]').disabled)
 assert.equal((await state()).history,before.history)

 await page.screenshot({path:shotPath('assist-preview.png')})
 await page.keyboard.press('Escape');await page.waitForSelector('[data-test=sketch-assist-dialog]',{hidden:true});assert.deepEqual(await state(),before)
 await click('[data-test=sketch-assist]');await page.waitForFunction(()=>document.querySelector('[data-test=sketch-assist-accept]')?.disabled===false)
 const preview=(await state()).entities;await click('[data-test=sketch-assist-accept]');await page.waitForSelector('[data-test=sketch-assist-dialog]',{hidden:true});assert.deepEqual((await state()).entities,preview);assert.equal((await state()).history,before.history+1)
 await page.evaluate(()=>window.__re.store.getState().undoSketch());assert.equal((await state()).entities.length,0)
 await page.evaluate(()=>window.__re.store.getState().redoSketch());assert.deepEqual((await state()).entities,preview)
 await click('[data-test=sketch-export-options]');await page.select('[aria-label="Sketch export format"]','dxf-r12');await page.keyboard.press('Escape');await page.waitForSelector('[data-test=sketch-export-options-dialog]',{hidden:true})
 await click('[data-test=sketch-export-options]');assert.equal(await page.$eval('[aria-label="Sketch export format"]',e=>e.value),'iges');await page.keyboard.press('Escape')
 const exported=[]
 for(const format of ['iges','dxf-r14','dxf-r12']){
  await click('[data-test=sketch-export-options]');await page.select('[aria-label="Sketch export format"]',format);await click('[data-test=sketch-export-options-ok]')
  const directory=join(downloads,format);mkdirSync(directory);await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:directory});
  const names=new Set(readdirSync(directory));await click('[data-test=sketch-export-iges]')
  let file;for(let i=0;i<100;i++){file=readdirSync(directory).find(n=>!names.has(n)&&!n.endsWith('.crdownload'));if(file)break;await new Promise(r=>setTimeout(r,100))}
  assert.ok(file);const text=readFileSync(join(directory,file),'utf8');writeFileSync(shotPath(`oyz-offset2-${format}.${format==='iges'?'igs':'dxf'}`),text)
  if(format==='iges'){const parameters=text.split(/\r?\n/).filter(l=>l[72]==='P').map(l=>l.slice(0,64)).join('');assert.ok(parameters.includes('124,1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0,0.0;'))}
  else assert.ok(text.includes(format==='dxf-r14'?'AC1014':'AC1009'))
  exported.push({format,file})
 }
 assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');assert.deepEqual(consoleErrors,[])
 writeFileSync(shotPath('assist-export.json'),JSON.stringify({fixtureSHA256:'705a33aed997598451bdab9418796811baaf5dbf3ed75389f02f7bffb6fb04cc',before,after:await state(),exported,consoleErrors},null,2))
 await page.screenshot({path:shotPath('assist-export-result.png')})
 console.log('PASS same-mesh OYZ offset2 Sketch Assist preview/cancel/accept/undo; IGES local XY; DXF R14/R12 choices, cancel and downloads; dark theme')
}finally{await browser.close()}
