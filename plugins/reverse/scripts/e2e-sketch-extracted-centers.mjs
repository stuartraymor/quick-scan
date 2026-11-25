// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { click, check, finish, launchApp, loadScan, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { openReverse, reverseHelpers } from './lib.mjs'

// Two scanned cylindrical walls intersected by the XY sketch plane.
const mesh = []
const profiles = [[-8, 3, 4], [8, 4, 2]]
for (const [j, [x, y, radius]] of profiles.entries()) {
  for (const z of [-3, 3]) for (let i = 0; i < 120; i++) {
    const theta = i * Math.PI / 60
    mesh.push(`v ${x + radius * Math.cos(theta)} ${y + radius * Math.sin(theta)} ${z}`)
  }
  for (let i = 0; i < 120; i++) {
    const a = j * 240 + i + 1, b = j * 240 + (i + 1) % 120 + 1
    mesh.push(`f ${a} ${b} ${b + 120}`, `f ${a} ${b + 120} ${a + 120}`)
  }
}
const file = shotPath('two-bores.obj')
writeFileSync(file, mesh.join('\n'))
const { browser, page, consoleErrors } = await launchApp()
const { re } = reverseHelpers(page)
const at = p => re(p => window.__re.sheet().sheetScreenPoint(p), p)
const draft = () => re(() => {
  const d = window.__re.store.getState().sketchDraft
  return { ...d.sketch, ok: d.report?.ok, error: d.error }
})
const clickPoint = async p => { const q = await at(p); await page.mouse.click(q.x, q.y); await sleep(100) }
const drag = async (p, q, held) => {
  const a = await at(p), b = await at(q)
  await page.mouse.move(a.x, a.y); await page.mouse.down()
  try {
    await page.mouse.move(b.x, b.y, {steps: 45}); await sleep(120)
    if (held) await held()
  } finally { await page.mouse.up() }
  await sleep(180)
}
const near = (a, b, tol = 0.02) => Math.hypot(a[0] - b[0], a[1] - b[1]) < tol
const circles = s => s.entities.filter(e => e.kind === 'circle')
const shortcut = async k => { await page.keyboard.down('Control'); await page.keyboard.press(k); await page.keyboard.up('Control'); await sleep(150) }
try {
  await loadScan(page, file); await openReverse(page)
  if (await page.$('[data-test=support-card] .sc-x')) await click(page, '[data-test=support-card] .sc-x')
  await re(async () => {
    const shell = await import('/src/state/shellStore.ts')
    shell.useShell.getState().setInspectorMode('docked')
    window.__re.store.getState().startSketch({kind:'world', axis:'z', offset:0}, {origin:[0,0,0], normal:[0,0,1], basisU:[1,0,0], basisV:[0,1,0]})
  })
  await click(page, '[data-test=sketch-extract]'); await click(page, '[data-test=sketch-fit-circle]')
  for (const [x, y, r] of profiles) {
    const path = Array.from({length:41}, (_, i) => [x + r * Math.cos(i * Math.PI / 28), y + r * Math.sin(i * Math.PI / 28)])
    const first = await at(path[0]); await page.mouse.move(first.x, first.y); await page.mouse.down()
    for (const p of path.slice(1)) { const q = await at(p); await page.mouse.move(q.x, q.y) }
    await page.mouse.up(); await sleep(250)
  }
  const original = circles(await draft())
  assert.equal(original.length, 2)
  assert(original.every((e, i) => e.points?.length > 10 && near(e.c, profiles[i]) && Math.abs(e.r - profiles[i][2]) < 0.02))
  console.log('PASS: two circles measured from painted sections')
  await click(page, '[data-test=sketch-fit-back]')
  await click(page, '[data-test=sketch-tool-line]')
  await clickPoint([-5,-4]); await clickPoint([9,-4]); await page.keyboard.press('Escape')
  await click(page, '[data-test=sketch-tool-select]')
  let line = (await draft()).entities.find(e => e.kind === 'line')
  assert(line, 'line drawn in empty space')
  const mid = line.a.map((v,i) => (v + line.b[i])/2)
  await clickPoint(mid); await click(page, '[data-test=sketch-construction]')
  assert((await draft()).entities.find(e => e.id === line.id).construction)
  await drag(original[1].c, original[0].c)
  let s = await draft()
  console.log('first drop', s.error, circles(s).map(e=>[e.c,e.r]),s.constraints)
  assert(s.ok && !s.error && s.constraints.some(c=>c.kind==='coincident' && c.p.at==='center' && c.q.at==='center'))
  assert(circles(s).every((e,i)=>near(e.c,original[0].c) && Math.abs(e.r-original[i].r)<0.01))
  console.log('PASS: center drag joined the two fitted circles')
  await drag(original[0].c, mid, async () => {
    const live = circles(await draft())
    console.log('held', live.map(e=>[e.c,e.r]), 'target', mid)
    assert(live.every(e => near(e.c,mid,0.08)), 'both circles follow the pointer before release')
    await page.screenshot({path:shotPath('held-midpoint.png')})
  })
  s = await draft()
  const joined = c => c.kind === 'coincident' && [c.p,c.q].some(a => a.entity===line.id && a.at==='center')
  assert(s.ok && !s.error && s.constraints.some(joined), 'midpoint relation retained on release')
  assert(circles(s).every((e,i)=>near(e.c,mid) && Math.abs(e.r-original[i].r)<0.01))
  await shortcut('z'); assert(circles(await draft()).every(e=>near(e.c,original[0].c)))
  await shortcut('y'); assert(circles(await draft()).every(e=>near(e.c,mid)))
  await click(page,'[data-test=sketch-ok-cancel] button.primary')
  const id = await re(()=>window.__re.store.getState().features.find(f=>f.kind==='sketch').id)
  await page.click(`[data-test="explorer-history-feature-${id}"]`,{count:2})
  await page.waitForSelector('[data-test=sketch-editor]')
  s=await draft()
  assert(s.ok && s.constraints.some(joined) && circles(s).every((e,i)=> near(e.c,mid) && Math.abs(e.r-original[i].r)<0.01))
  console.log('PASS: midpoint, both radii and center relations survived Undo, Redo, OK and History reopen')
} catch (error) { check(false,error.stack) }
await finish(browser,consoleErrors)
