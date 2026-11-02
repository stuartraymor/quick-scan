// SPDX-License-Identifier: AGPL-3.0-only
// Click real commands, inspect their visible widgets and replay closing them.
import {writeFileSync} from 'node:fs'
import {launchApp,loadScan,check,fail,finish,shotPath} from './e2e-lib.mjs'
const mesh=[]
for(let y=0;y<5;y++)for(let x=0;x<5;x++)mesh.push(`v ${x*5} ${y*5} 3`)
for(let y=0;y<4;y++)for(let x=0;x<4;x++){const a=y*5+x+1;mesh.push(`f ${a} ${a+1} ${a+6}`,`f ${a} ${a+6} ${a+5}`)}
const fixture=shotPath('widget-plane.obj');writeFileSync(fixture,mesh.join('\n'))
const {browser,page,consoleErrors}=await launchApp({agentDataOk:false})
const captures=[]
const inspect=()=>page.$eval('[data-test=tool-inspector]',el=>{
 const box=el.getBoundingClientRect(),s=getComputedStyle(el)
 return {title:el.getAttribute('aria-label'),width:box.width,background:s.backgroundColor,font:s.fontFamily,
  visible:!el.hidden,overflow:el.scrollWidth>el.clientWidth+1,
  controls:[...el.querySelectorAll('button,input,select')].filter(e=>e.getClientRects().length).map(e=>({test:e.dataset.test,kind:e.tagName,label:e.title||e.getAttribute('aria-label')||e.textContent.trim(),disabled:e.disabled}))}
})
try{
 await loadScan(page,fixture)
 await page.evaluate(()=>document.documentElement.dataset.theme='dark')
 await page.click('[data-test=ribbon-extract-primitives]')
 const extraction=await inspect();captures.push(extraction)
 check(extraction.background==='rgb(37, 40, 44)'&&extraction.font.includes('Segoe UI'),'compact command widgets use the requested charcoal desktop face in dark app mode')
 check(Math.abs(extraction.width-286)<1,'extraction opens at the compact reference dialog width')
 await page.click('[data-test=extract-select-all]')
 await page.waitForFunction(()=>!document.querySelector('[data-test=extract-type-plane]').disabled)
 await page.click('[data-test=extract-type-plane]');await page.waitForSelector('[data-test=extract-preview]')
 check(await page.evaluate(()=>{const a=document.querySelector('[data-test=extract-clear-preview]').getBoundingClientRect(),b=document.querySelector('[data-test=extract-type-plane]').getBoundingClientRect();return Math.abs((a.top+a.bottom-b.top-b.bottom)/2)<2}),'Clear sits beside the primitive icons')
 check(await page.evaluate(()=>{const a=document.querySelector('[data-test=extract-create-stay]').getBoundingClientRect(),b=document.querySelector('[data-test=extract-create]').getBoundingClientRect(),c=document.querySelector('[data-test=extract-close]').getBoundingClientRect();return a.bottom<=b.top+1&&Math.abs(b.top-c.top)<2}),'Create & Stay sits above the Create / Close footer row')
 await page.screenshot({path:shotPath('widget-extraction.png')})
 await page.click('[data-test=extract-close]');await page.click('[data-test=extract-close-no]')
 for(const kind of ['point','line','plane','sphere','cylinder','cone','circle','torus']){
  await page.evaluate(async()=>{(await import('/src/state/shellStore.ts')).useShell.getState().setInspectorOpen(true)})
  await page.click(`[data-test=fit-${kind}]`)
  await page.waitForFunction(()=>window.__scanruler.measure.getState().draft!==null)
  const widget=await inspect();captures.push(widget)
  check(!widget.overflow&&await page.evaluate(()=>{const p=document.querySelector('.panel[data-core-command=draft]');return [...p.children].filter(e=>getComputedStyle(e).display!=='none').every(e=>e.classList.contains('core-command-draft'))}),`${kind} opens its own controls without unrelated dashboard sections`)
  await page.screenshot({path:shotPath(`widget-${kind}.png`)})
  await page.click('[data-test=hide-tool-inspector]')
  check(await page.evaluate(()=>!window.__scanruler.measure.getState().draft&&document.querySelector('[data-test=tool-inspector]').hidden),`${kind} title-bar X closes the command through Cancel`)
 }
 await page.evaluate(async()=>{(await import('/src/state/shellStore.ts')).useShell.getState().setWorkspace('reverse')})
 await page.waitForFunction(()=>!!window.__re)
 await page.evaluate(()=>{window.__re.store.getState().startSketch({kind:'world',axis:'z',offset:0},{origin:[0,0,0],normal:[0,0,1],basisU:[1,0,0],basisV:[0,1,0]});window.__re.store.setState(s=>({sketchDraft:{...s.sketchDraft,placing:true}}))})
 await page.waitForSelector('[data-test=place-offset-apply]',{visible:true})
 const sketch=await inspect();captures.push(sketch)
 check(sketch.title==='Create Sketch'&&!sketch.overflow,'2D Sketch opens a dedicated Create Sketch widget')
 const order=await page.$$eval('[data-test=place-sketch] [data-test]',els=>els.map(e=>e.getAttribute('data-test')))
 const want=['place-mode-extruded','place-mode-revolved','place-planes','place-pick','place-offset','place-offset-apply','place-define-interactive','place-snap-xy','place-hide-scan','place-flip','place-on-slice','place-through-selection','place-stacked','place-stacked-count','place-stacked-apply','place-outline-mode']
 const at=want.map(k=>order.indexOf(k))
 check(at.every((i,n)=>i>=0&&(n===0||i>at[n-1])),'Create Sketch lists its controls in QUICKSURFACE order: mode, plane, parallel to, offset, define interactive, snap, ignore scan data, flip, slicing plane, through selection, stacked sections, outline mode')
 check(await page.$eval('[data-test=place-flip]',e=>e.disabled&&e.title.includes('Not built')),'options with no behaviour yet are greyed and say so, not silently inert')
 check(await page.$eval('[data-test=place-stacked-count]',e=>e.disabled)&&await page.$eval('[data-test=place-stacked-apply]',e=>e.disabled),'Sections count and Apply remain visible and disabled until Stacked sections is checked')
 await page.click('[data-test=place-stacked]')
 check(await page.$eval('[data-test=place-stacked-count]',e=>!e.disabled),'checking Stacked sections enables its existing count field')
  await page.click('[data-test=place-offset]');await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');await page.keyboard.type('12.7')
  await page.evaluate(()=>{window.__widgetCanvas=document.querySelector('.viewport canvas');window.__widgetOffset=document.querySelector('[data-test=place-offset]')})
  await page.click('[data-test=toggle-inspector-dock]')
  check(await page.evaluate(()=>document.querySelector('[data-test=place-offset]')===window.__widgetOffset&&window.__widgetOffset.value==='12.7'&&document.querySelector('.viewport canvas')===window.__widgetCanvas),'docking preserves the canvas, editor and pending field value')
  await page.click('[data-test=toggle-inspector-dock]')
 await page.screenshot({path:shotPath('widget-create-sketch.png')})
 await page.click('[data-test=hide-tool-inspector]')
 check(await page.evaluate(()=>window.__re.store.getState().sketchDraft===null),'Create Sketch title-bar X cancels placement')
 await page.setViewport({width:1000,height:720})
 await page.evaluate(async()=>{const shell=(await import('/src/state/shellStore.ts')).useShell.getState();shell.setWorkspace('elements');shell.setExtractOpen(true)})
 await page.waitForSelector('[data-test=extract-dialog]',{visible:true})
 check(await page.$eval('[data-test=tool-inspector]',el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}), 'the floating widget stays inside a 1000 × 720 window')
 await page.screenshot({path:shotPath('widget-small-window.png')})
 writeFileSync(shotPath('widget-controls.json'),JSON.stringify(captures,null,2))
}catch(error){fail(error.stack??String(error))}
finally{await finish(browser,consoleErrors)}
