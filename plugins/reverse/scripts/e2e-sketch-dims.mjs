// SPDX-License-Identifier: AGPL-3.0-only
// End-to-end test of the sketch's dimensions as a drawing carries them and of
// the corner tools beside the drawing tools: Fillet and Chamfer sit in the
// tool row, a chamfer comes out with its two distances, every dimension is a
// number written along its line that a drag moves and a click opens.
//
// Prereqs: dev server running (npm run dev), Chrome installed.
//   node plugins/reverse/scripts/e2e-sketch-dims.mjs
// Env: CHROME (chrome.exe path), APP_URL, SHOT_DIR.
import { writeFileSync } from 'node:fs'
import { check, click, drag, finish, launchApp, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { reverseHelpers } from './lib.mjs'

const { browser, page, consoleErrors } = await launchApp({ width: 1600, height: 1000, protocolTimeout: 600_000 })
const { re } = reverseHelpers(page)

await page.click('[data-test=workspace-reverse]')
await page.waitForSelector('[data-test=kernel-status]')
await sleep(300)

await re(() => {
  const frame = { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }
  const s = () => window.__re.store.getState()
  s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, frame)
  s().setSketchTool('rectangle')
  s().sketchClick([0, 0], 0.01, false, { off: true })
  s().sketchClick([21, 24], 0.01, false, { off: true })
  s().setSketchTool('line')
  s().sketchClick([21, 0], 0.5, false, {})
  s().sketchClick([32, 14], 0.01, false, { off: true })
  s().setSketchTool('select')
})
await sleep(800)

// Current toolbar: Fillet remains a Modify operation. Chamfer is an existing
// core operation, not an exposed native-parity toolbar button in this build.
check(await page.$('[data-test=sketch-edit] [data-test=sketch-tool-fillet]') !== null, 'current Quick Scan Modify row exposes Fillet')
await re(() => window.__re.store.getState().setSketchTool('chamfer'))
check(await re(() => window.__re.store.getState().sketchDraft.tool) === 'chamfer', 'existing Chamfer operation can be armed for core geometry regression')
const chamfer = await re(() => {
  const s = () => window.__re.store.getState()
  s().sketchClick([0, 24], 0.5, false, {})
  const d = s().sketchDraft
  return { error: d.error, lines: d.sketch.entities.length, distances: d.sketch.constraints.filter((c) => c.kind === 'distance').map((c) => c.value) }
})
check(chamfer.error === null && chamfer.lines === 6 && chamfer.distances.length === 2 && chamfer.distances[0] === chamfer.distances[1], `a click on a corner chamfers it, two equal distances out (${JSON.stringify(chamfer)})`)

await click(page, '[data-test=sketch-tool-fillet]')
const fillet = await re(() => {
  const s = () => window.__re.store.getState()
  s().sketchClick([21, 24], 0.5, false, {})
  const d = s().sketchDraft
  return { error: d.error, arcs: d.sketch.entities.filter((e) => e.kind === 'arc').length }
})
check(fillet.error === null && fillet.arcs === 1, `a click on the next corner rounds it (${JSON.stringify(fillet)})`)

// ---- dimensions: a length, a slanted length, an angle ------------------------------------
const ids = await re(() => {
  const s = () => window.__re.store.getState()
  s().setSketchTool('dimension')
  // Each in hand once clicked, put down where the layout has it.
  s().sketchClick([10, 0], 0.5, false, {})
  s().putDownDimension()
  const bottom = s().sketchDraft.selectedConstraint
  s().sketchClick([26.5, 7], 0.5, false, {})
  s().putDownDimension()
  const slant = s().sketchDraft.selectedConstraint
  s().sketchClick([26.5, 7], 0.5, false, {})
  s().sketchClick([10, 0], 0.5, false, {})
  s().putDownDimension()
  const angle = s().sketchDraft.selectedConstraint
  s().setSketchTool('select')
  return { bottom, slant, angle }
})
await sleep(600)
// The last one put down opened for typing; nothing typed, it closes.
check((await page.$(`[data-test=flat-dimension-${ids.angle}] input`)) !== null, 'a dimension put down opens its number on the sheet for typing')
await re(() => document.activeElement?.blur?.())
await sleep(200)
const label = (id) => page.$(`[data-test=flat-dimension-${id}]`)
check((await label(ids.bottom)) !== null && (await label(ids.slant)) !== null && (await label(ids.angle)) !== null, 'each dimension has its number on the sheet')
const text = await page.$eval(`[data-test=flat-dimension-${ids.bottom}] .label-value`, (v) => v.textContent)
check(text === '21', `a whole length is written without zeros behind it (${text})`)
const turned = await page.$eval(`[data-test=flat-dimension-${ids.slant}] .label-value`, (v) => v.style.transform)
check(/rotate\(-5\d/.test(turned), `the slanted length's number is written along its line (${turned})`)
await page.screenshot({ path: shotPath('sketch-dims-1.png') })

// ---- a drag moves the number, a click opens it ---------------------------------------------
const box = await (await label(ids.bottom)).boundingBox()
const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
await drag(page, [from.x, from.y], [from.x + 40, from.y + 70])
const place = await re((id) => window.__re.store.getState().sketchDraft.sketch.constraints.find((c) => c.id === id).place ?? null, ids.bottom)
check(place !== null && Math.abs(place.off) > 1, `a drag on the number moves the dimension off its line (${JSON.stringify(place)})`)
check((await page.$(`[data-test=flat-dimension-${ids.bottom}] input`)) === null, 'and opens no field')
const after = await (await label(ids.bottom)).boundingBox()
check(Math.abs(after.y + after.height / 2 - (from.y + 70)) < 6, 'the number lies where it was dropped')
const moved = await re(() => window.__re.store.getState().sketchDraft.sketch.entities[0])
check(Math.abs(moved.a[1]) < 1e-9 && Math.abs(moved.b[1]) < 1e-9, 'the line it measures has not moved')

const slantBox = await (await label(ids.slant)).boundingBox()
await drag(page, [slantBox.x + slantBox.width / 2, slantBox.y + slantBox.height / 2], [slantBox.x + 90, slantBox.y + 60])
await sleep(300)
await page.screenshot({ path: shotPath('sketch-dims-2.png') })

const b2 = await (await label(ids.bottom)).boundingBox()
await page.mouse.click(b2.x + b2.width / 2, b2.y + b2.height / 2)
await sleep(200)
check((await page.$(`[data-test=flat-dimension-${ids.bottom}] input`)) !== null, 'a click on the number opens it for typing')
await page.keyboard.type('25')
await page.keyboard.press('Enter')
await sleep(400)
const value = await re((id) => window.__re.store.getState().sketchDraft.sketch.constraints.find((c) => c.id === id), ids.bottom)
check(value.value === 25 && value.place != null, `the typed value is taken and the number stays where it was put (${JSON.stringify(value)})`)

await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.press('z')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await sleep(300)
const undone = await re((id) => window.__re.store.getState().sketchDraft.sketch.constraints.find((c) => c.id === id), ids.bottom)
check(undone.value === 21 && undone.place == null, `undo walks back through the value and the moves (${JSON.stringify(undone)})`)

await page.screenshot({ path: shotPath('sketch-dims-3.png') })
// Native-paired angle case: two 45-degree lines, D, two graphical picks,
// place the number, type60, and compare the solved angle rather than positions.
await re(async () => (await import('/src/state/shellStore.ts')).useShell.getState().setInspectorMode('docked'))
await re(() => window.__re.store.getState().startSketch({kind:'world',axis:'z',offset:0},{origin:[0,0,0],normal:[0,0,1],basisU:[1,0,0],basisV:[0,1,0]},[{kind:'line',a:[0,0],b:[30,0]},{kind:'line',a:[0,0],b:[22,22]}]))
await sleep(350)
await click(page,'[data-test=sketch-tool-select]')
const angleClick=async p=>{const q=await re(p=>window.__re.sheet().sheetScreenPoint(p),p);await page.mouse.click(q.x,q.y);await sleep(100)}
await page.keyboard.press('d');await angleClick([15,0]);await angleClick([11,11]);
const angleHeld=await re(()=>window.__re.store.getState().sketchDraft.dimMade)
check(angleHeld!=null,'D and two graphical line picks create a pending angular dimension')
await angleClick([21,8]);await page.waitForSelector(`[data-test=flat-dimension-${angleHeld}] input`)
await page.focus(`[data-test=flat-dimension-${angleHeld}] input`);await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');await page.keyboard.type('60');await page.keyboard.press('Enter');await sleep(250)
const angular=await re(id=>{const d=window.__re.store.getState().sketchDraft,c=d.sketch.constraints.find(c=>c.id===id),[a,b]=d.sketch.entities.filter(e=>e.kind==='line');const u=[a.b[0]-a.a[0],a.b[1]-a.a[1]],v=[b.b[0]-b.a[0],b.b[1]-b.a[1]],angle=Math.acos(Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1])/(Math.hypot(...u)*Math.hypot(...v)))))*180/Math.PI;return {constraint:c,angle,ok:d.report?.ok}},angleHeld)
check(angular.constraint?.kind==='angle'&&angular.constraint.value===60&&Math.abs(angular.angle-60)<1e-5&&angular.ok,'typed60 drives the actual line angle within1e-5degrees, matching native numeric acceptance')
const angularLabel=await page.$eval(`[data-test=flat-dimension-${angleHeld}]`,e=>({text:e.textContent,visible:e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0}))
check(angularLabel.visible&&angularLabel.text.includes('60')&&angularLabel.text.includes('°'),'angular callout visibly shows60degrees on the graphics sheet')
await page.screenshot({path:shotPath('sketch-angle-60.png')})
await page.keyboard.down('Control');await page.keyboard.press('z');await page.keyboard.up('Control');await sleep(150)
const undoneAngle=await re(()=>{const [a,b]=window.__re.store.getState().sketchDraft.sketch.entities.filter(e=>e.kind==='line'),u=[a.b[0]-a.a[0],a.b[1]-a.a[1]],v=[b.b[0]-b.a[0],b.b[1]-b.a[1]];return Math.acos(Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1])/(Math.hypot(...u)*Math.hypot(...v)))))*180/Math.PI})
check(Math.abs(undoneAngle-45)<1e-5,'Undo restores the original45degree geometry')
writeFileSync(shotPath('sketch-angle-60.json'),JSON.stringify({angular,angularLabel,undoneAngle,toleranceDeg:1e-5,nativeAngleDeg:60.00000038375945},null,2))

await finish(browser, consoleErrors)
