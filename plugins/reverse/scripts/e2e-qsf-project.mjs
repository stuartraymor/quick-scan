// SPDX-License-Identifier: AGPL-3.0-only
// Public Open/Save workflow, including atomic refusal of unsupported records.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { unzipSync, strFromU8 } from 'fflate'
import { launchApp, check, finish, shotPath } from '../../../scripts/e2e-lib.mjs'
const fixture=fileURLToPath(new URL('../tests/fixtures/qsf/cylinder-solid.qsf',import.meta.url))
const original=new Uint8Array(readFileSync(fixture))
const {browser,page,consoleErrors}=await launchApp({width:1500,height:960})
page.on('dialog',d=>d.accept())
const drop=(bytes,name)=>page.evaluate((bytes,name)=>{
 const d=new DataTransfer();d.items.add(new File([new Uint8Array(bytes)],name));window.dispatchEvent(new DragEvent('drop',{dataTransfer:d,bubbles:true,cancelable:true}))
},Array.from(bytes),name)
try {
 await (await page.$('[data-test=project-input]')).uploadFile(fixture)
 await page.waitForFunction(()=>document.querySelectorAll('[data-test=feature-row]').length===2,{timeout:60000})
 await page.waitForFunction(()=>/ready/i.test(document.querySelector('[data-test=kernel-status]')?.textContent??''),{timeout:60000})
 check(await page.evaluate(()=>document.documentElement.dataset.appReady==='true'&&!document.querySelector('#startup-status')),'startup surface is removed after React is ready')
 check(await page.evaluate(()=>document.documentElement.dataset.theme==='dark'),'QSF opens in the dark theme')
 await page.evaluate(()=>{const create=URL.createObjectURL;URL.createObjectURL=b=>{window.qsfSaved=b;return create(b)};HTMLAnchorElement.prototype.click=function(){}})
 await page.waitForFunction(()=>!document.querySelector('[data-test=save-project]')?.disabled,{timeout:60000})
 await page.click('[data-test=save-project]')
 await page.waitForFunction(()=>window.qsfSaved instanceof Blob)
 const saved=Uint8Array.from(await page.evaluate(async()=>Array.from(new Uint8Array(await window.qsfSaved.arrayBuffer()))))
 await page.waitForFunction(()=>document.querySelector('[data-test=project-save-status]')?.textContent.startsWith('No unsaved changes'))
 check(true,'saving a converted QSF clears the unsaved-changes indicator')
 const archive=unzipSync(saved), manifest=JSON.parse(strFromU8(archive['project.json']))
 const sketch=manifest.reverse.features.find(f=>f.kind==='sketch'),extrude=manifest.reverse.features.find(f=>f.kind==='extrude')
 check(sketch?.sketch.constraints[0]?.kind==='diameter'&&sketch.sketch.constraints[0].value===20,'Open and Save preserve the driving diameter')
 check(extrude?.sketchId===sketch?.id,'Open and Save preserve the extrusion dependency')
 check(manifest.scan.elements.some(e=>e.kind==='plane'),'datum plane survives conversion')
 check(Buffer.from(archive['source-project.qsf']??[]).equals(Buffer.from(original)),'saved project retains the exact original QSF bytes')
 await page.screenshot({path:shotPath('qsf-import.png')})
 await page.reload({waitUntil:'networkidle0'});await drop(saved,'roundtrip.scanruler')
 await page.waitForFunction(()=>document.querySelectorAll('[data-test=feature-row]').length===2,{timeout:60000})
 check(true,'converted Quick Scan project reopens through the public project workflow')
 const invalid=original.slice(),v=new DataView(invalid.buffer),n=v.getUint32(144,true)
 for(let i=0;i<n;i++)if(v.getUint32(148+8*i,true)===48){v.setUint32(148+8*i,777,true);v.setBigUint64(148+8*n+16*i,777n,true);break}
 await drop(invalid,'unsupported.qsf')
 await page.waitForFunction(()=>document.body.innerText.includes('cannot be opened without losing editable data'),{timeout:30000})
 check(await page.evaluate(()=>document.querySelectorAll('[data-test=feature-row]').length===2),'unsupported QSF contents leave the current project intact')
 await page.screenshot({path:shotPath('qsf-refused.png')})
 const preserved=fileURLToPath(new URL('../tests/fixtures/qsf/preserved-three-sketches.qsf',import.meta.url))
 await (await page.$('[data-test=project-input]')).uploadFile(preserved)
 await page.waitForFunction(()=>document.querySelectorAll('[data-test=feature-row]').length===3,{timeout:60000})
 await page.evaluate(()=>{const create=URL.createObjectURL;URL.createObjectURL=b=>{window.qsfSaved=b;return create(b)};HTMLAnchorElement.prototype.click=function(){};window.qsfSaved=null})
 await page.waitForFunction(()=>!document.querySelector('[data-test=save-project]')?.disabled,{timeout:60000})
 await page.click('[data-test=save-project]');await page.waitForFunction(()=>window.qsfSaved instanceof Blob)
 const converted=Uint8Array.from(await page.evaluate(async()=>Array.from(new Uint8Array(await window.qsfSaved.arrayBuffer()))))
 await page.waitForFunction(()=>document.querySelector('[data-test=project-save-status]')?.textContent.startsWith('No unsaved changes'))
 const convertedArchive=unzipSync(converted),part=JSON.parse(strFromU8(convertedArchive['project.json'])).reverse
 check(part.features.length===3&&part.features.every(f=>f.kind==='sketch'),'preserved project imports all three sketches in history')
 check(part.features[2].sketch.constraints.some(c=>c.kind==='coincident'),'shared endpoint constraint survives public Open and Save')
 check(Buffer.from(convertedArchive['source-project.qsf']).equals(readFileSync(preserved)),'preserved project source bytes survive conversion')
 await page.screenshot({path:shotPath('qsf-three-sketches.png')})
 await page.reload({waitUntil:'networkidle0'});await drop(converted,'three-sketches.scanruler')
 await page.waitForFunction(()=>document.querySelectorAll('[data-test=feature-row]').length===3,{timeout:60000})
 check(true,'three-sketch project reopens after conversion')

}catch(error){console.error(await page.evaluate(()=>document.body.innerText));await page.screenshot({path:shotPath('qsf-failure.png')});throw error}finally{await finish(browser,consoleErrors)}
