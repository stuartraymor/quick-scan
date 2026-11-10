// SPDX-License-Identifier: AGPL-3.0-only
// Fixture-only DEV seeding; commands and confirmations under test use UI input.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { launchApp, check, fail, finish, sleep } from '../../../scripts/e2e-lib.mjs'
import { openReverse } from './lib.mjs'

const out = resolve(process.env.VERIFY_OUT ?? 'C:/Users/stuar/Code/QUICKSCAN/analysis/quick-scan-v0.0.44/corner-project-browser')
mkdirSync(out, { recursive: true })
const { browser, page, consoleErrors } = await launchApp({ width: 1600, height: 1000, protocolTimeout: 180000 })
const results = []
const record = (ok, label) => { check(ok, label); results.push({ ok: Boolean(ok), label }) }
const shot = async name => { await sleep(250); await page.screenshot({ path: resolve(out, `${name}.png`) }) }
const state = () => page.evaluate(() => { const d = window.__re.store.getState().sketchDraft; return d ? { sketch: d.sketch, selection: d.selection, history: d.history.length } : null })
const seed = async source => page.evaluate(async source => {
  const { emptySketch, addEntity } = await import('/plugins/reverse/core/sketch.ts')
  const { useSketchCornerTrim } = await import('/plugins/reverse/state/sketchCornerTrimStore.ts')
  const { useSketchProject } = await import('/plugins/reverse/state/sketchProjectStore.ts')
  const { useSketchBrush } = await import('/plugins/reverse/state/sketchBrushStore.ts')
  useSketchCornerTrim.getState().setOpen(false); useSketchProject.getState().setOpen(false); useSketchBrush.getState().setOpen(false)
  const store = window.__re.store, frame = { origin: [0,0,0], normal: [0,0,1], basisU: [1,0,0], basisV: [0,1,0] }
  const origin = emptySketch()
  addEntity(origin, { kind: 'line', a: [-8,-4], b: [8,-4] }); addEntity(origin, { kind: 'circle', c: [0,5], r: 3 })
  store.setState({ features: source ? [{ id: 1, kind: 'sketch', name: 'Earlier visible profile', plane: { kind:'world',axis:'z',offset:3 }, frame: { ...frame, origin:[0,0,3] }, sketch: origin, visible: true }] : [], bodies: [], results: {}, past: [], future: [], nextFeatureId: 2, sketchDraft: null })
  store.getState().startSketch({ kind:'world',axis:'z',offset:0 }, frame, source ? [] : [{ kind:'line',a:[2,0],b:[20,0] }, { kind:'line',a:[0,2],b:[0,20] }])
  if (!source) store.setState(s => ({ sketchDraft: { ...s.sketchDraft, selection: [1,2] } }))
}, source)

try {
  await openReverse(page)
  await seed(false)
  await page.waitForSelector('[data-test="sketch-sharpen"]')
  const before = await state()
  await page.click('[data-test="sketch-sharpen"]')
  await page.waitForSelector('[data-test="sketch-corner-trim-panel"]')
  record(await page.$$eval('[aria-label="Corner finishing mode"] button', es => es.length === 3), 'Corner Trim opens three mode buttons')
  record(await page.$eval('[data-test="corner-radius"]', e => e.disabled && Number(e.value) === 1), 'default radius is one display millimetre and disabled in trim mode')
  record(await page.$eval('[data-test="corner-add-dimension"]',e=>e.disabled&&!e.checked), 'dimension checkbox starts unchecked and disabled for sharp trim')
  record(await page.$('[data-test="corner-apply"]') === null, 'native paint workflow needs no Apply button')
  record(await page.$('[data-test="sketch-context-tools"]') === null, 'sheet selection toolbar stands down for Corner Trim')
  const paint = async (held=false) => {
    const pts=await page.evaluate(()=>[[2,0],[0,2]].map(p=>window.__re.sheet().sheetScreenPoint(p)))
    await page.mouse.move(pts[0].x,pts[0].y);await page.mouse.down();await page.mouse.move(pts[1].x,pts[1].y,{steps:8})
    if(!held)await page.mouse.up()
  }
  await paint(true)
  record(JSON.stringify((await state()).sketch)===JSON.stringify(before.sketch),'held endpoint paint does not drag or alter geometry')
  record(await page.$eval('[data-test="sketch-corner-trim-overlay"]',el=>{const p=el.getContext('2d').getImageData(0,0,el.width,el.height).data;let n=0;for(let i=0;i<p.length;i+=4)if(p[i]===113&&p[i+1]===131&&p[i+2]===139&&p[i+3]>200)n++;return n>40}),'gray native-style stroke is actually rendered')
  await shot('01-corner-held')
  await page.mouse.up();await sleep(100)
  record((await state()).sketch.constraints.some(c=>c.kind==='coincident'),'release joins the endpoints immediately')
  record((await state()).history===before.history+1,'release is exactly one undo step')
  await page.click('[data-test="undo"]')
  record(JSON.stringify((await state()).sketch)===JSON.stringify(before.sketch),'Undo restores separated endpoints')
  await paint(true);await page.keyboard.press('Escape');await page.mouse.up()
  record(JSON.stringify((await state()).sketch)===JSON.stringify(before.sketch),'Escape cancels held paint without an edit')
  record(await page.$('[data-test="sketch-corner-trim-panel"]')!==null,'cancelling paint keeps the corner tool available')
  await page.click('[data-test="corner-mode-fixedFillet"]')
  await page.click('[data-test="corner-radius"]');await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');await page.keyboard.type('3');await page.keyboard.press('Tab')
  await page.click('[data-test="corner-add-dimension"]')
  await paint();await sleep(100)
  record((await state()).sketch.entities.some(e=>e.kind==='arc'&&Math.abs(e.r-3)<1e-5),'fixed-size paint creates a radius-three fillet on release')
  record((await state()).sketch.constraints.filter(c=>c.kind==='tangent').length===2,'painted fillet is tangent to both lines')
  record((await state()).sketch.constraints.some(c=>c.kind==='radius'&&Math.abs(c.value-3)<1e-5),'enabled dimension creates an actual radius constraint')
  await shot('02-fixed-fillet-release')
  await page.click('[data-test="undo"]');await page.click('[data-test="corner-cancel"]')
  record(await page.$('[data-test="sketch-corner-trim-panel"]')===null,'OK returns to sketch controls')

  await seed(true)
  await page.click('[data-test="sketch-tool-project"]')
  await page.waitForSelector('[data-test="sketch-project-panel"]')
  await page.waitForFunction(() => document.querySelector('[data-test="sketch-project-overlay"] path')?.getAttribute('d')?.length > 30)
  record(await page.$eval('[data-test="sketch-project-overlay"] path', el => el.getAttribute('stroke') === '#008c45' && el.getAttribute('d').length > 30), 'Project renders actual green line/circle preview paths')
  record((await state()).sketch.entities.length === 0, 'Project previews without inserting geometry')
  record(await page.$eval('[data-test="sketch-project-count"]', el => el.textContent.includes('2 entities')), 'Project lists the visible source line and circle')
  record(await page.$('[data-test="sketch-context-tools"]') === null, 'sheet selection toolbar stands down for Project')
  await shot('03-visible-sketch-project-preview')
  await page.click('[data-test="sketch-project-cancel"]')
  record((await state()).sketch.entities.length === 0, 'Project Cancel preserves the empty target')
  await page.click('[data-test="sketch-tool-project"]'); await page.click('[data-test="sketch-project-create"]')
  await page.waitForSelector('[data-test="sketch-tool-project"]')
  const projected = (await state()).sketch.entities
  record(projected.length === 2 && projected.some(e=>e.kind==='circle') && projected.some(e=>e.kind==='line'), 'Project Create inserts exact circle and line entities')
  record(projected.every(e=>e.fixed&&e.projected&&e.source?.sketch===1), 'projected geometry is fixed and linked to the earlier sketch')
  await shot('04-projected-circle-line')
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control')
  await page.waitForFunction(() => window.__re.store.getState().sketchDraft.sketch.entities.length === 0)
  record((await state()).sketch.entities.length === 0, 'keyboard Undo removes the projection as one edit')
  await page.evaluate(() => window.__re.store.setState({features:[]}))
  await page.click('[data-test="sketch-tool-project"]')
  await page.waitForSelector('[data-test="sketch-project-empty"]')
  record(await page.$eval('[data-test="sketch-project-create"]',el=>el.disabled), 'Project empty case disables Create with an honest message')
  await shot('05-project-empty')
  await page.click('[data-test="sketch-project-cancel"]')
  record(await page.$('[data-test="sketch-project-panel"]') === null, 'Project Cancel returns to main sketch controls')
} catch (error) {
  fail(error.stack ?? error.message); results.push({ok:false,label:error.message})
  await shot('failure').catch(()=>{})
} finally {
  writeFileSync(resolve(out,'results.json'),JSON.stringify({results,consoleErrors},null,2))
  await finish(browser,consoleErrors)
}
