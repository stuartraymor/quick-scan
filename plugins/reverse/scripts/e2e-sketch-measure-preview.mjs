// SPDX-License-Identifier: AGPL-3.0-only
// 1.2.24, by mouse: Analysis → Measure's Sketch way with no scan open, the
// snap bar's Pick switches deciding what it takes, and the preview drawn
// under the cursor before a click. Circle A about (−7, 4), r 3; circle B
// about (8, 6), r 1.5, on a sketch made with no scan loaded.
import { check, click, finish, launchApp, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { openReverse, reverseHelpers } from './lib.mjs'

const { browser, page, consoleErrors } = await launchApp({ width: 1500, height: 960, protocolTimeout: 600_000 })
const { re } = reverseHelpers(page)
const onSheet = (p) => re((q) => window.__re.sheet().sheetScreenPoint(q), p)
const clickAt = async (pixel) => {
  const onCanvas = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName === 'CANVAS', pixel)
  if (!onCanvas) throw new Error(`the click at ${JSON.stringify(pixel)} would not land on the view`)
  await page.mouse.move(pixel.x, pixel.y); await sleep(100); await page.mouse.click(pixel.x, pixel.y); await sleep(300)
}
const hoverAt = async (pixel) => { await page.mouse.move(pixel.x - 3, pixel.y - 2); await page.mouse.move(pixel.x, pixel.y, { steps: 3 }); await sleep(250) }
const sketchNow = () => re(() => JSON.stringify(window.__re.store.getState().sketchDraft?.sketch))
const preview = () => page.evaluate(() => ({
  label: document.querySelector('[data-test=measure-preview-label]')?.textContent ?? null,
  outlines: document.querySelectorAll('[data-test=measure-preview-outline]').length,
  points: document.querySelectorAll('[data-test=measure-preview-point]').length,
}))
/** The readouts listed, the newest first, as the dialog lists them. */
const readouts = () => page.evaluate(() => [...document.querySelectorAll('[data-test=measure-readout] b')].map((b) => b.textContent))
const analysisTab = async () => { await page.evaluate(() => [...document.querySelectorAll('button, [role=tab]')].find((b) => b.textContent.trim() === 'Analysis')?.click()); await sleep(400) }
const R = 3, r = 1.5, A = [-7, 4], B = [8, 6]
try {
  await page.evaluate(() => localStorage.removeItem('scanruler.snapfilter'))
  check(await page.evaluate(() => !document.querySelector('[data-test=mesh-status]')?.textContent?.match(/triangles/)), 'no scan is open')

  // ---- no scan, no sketch: nothing to measure -------------------------------------
  await analysisTab()
  check(await page.$eval('[data-test=ribbon-measure]', (el) => el.disabled), 'with no scan and no sketch, Analysis → Measure is greyed')

  // ---- a sketch with no scan ------------------------------------------------------
  await openReverse(page)
  if (await page.$('[data-test=support-card] .sc-x')) await click(page, '[data-test=support-card] .sc-x')
  await re(() => {
    window.__re.store.getState().startSketch({ kind: 'world', axis: 'z', offset: 0 }, { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] })
    window.__re.store.setState((s) => ({ sketchDraft: { ...s.sketchDraft, placing: true } }))
  })
  await page.waitForSelector('[data-test=place-create]')
  if (await page.$eval('[data-test=tool-inspector]', (el) => el.dataset.mode === 'floating')) await click(page, '[data-test=toggle-inspector-dock]')
  await click(page, '[data-test=place-create]')
  await page.waitForSelector('[data-test=sketch-editor]'); await sleep(800)
  // Circle A drawn by mouse; circle B added as A's twin, both then set
  // exact, so the expected figures are round.
  await click(page, '[data-test=sketch-tool-circle]')
  await clickAt(await onSheet(A)); await clickAt(await onSheet([A[0] + 2.9, A[1] + 0.4]))
  await click(page, '[data-test=sketch-tool-select]'); await page.keyboard.press('Escape'); await sleep(200)
  await re(([a, ra, b, rb]) => window.__re.store.setState((s) => {
    const sk = s.sketchDraft.sketch
    const ca = sk.entities.find((e) => e.kind === 'circle')
    const entities = [...sk.entities.map((e) => (e.id === ca.id ? { ...e, c: a, r: ra } : e)), { ...ca, id: sk.nextId, c: b, r: rb }]
    return { sketchDraft: { ...s.sketchDraft, sketch: { ...sk, entities, nextId: sk.nextId + 1 } } }
  }), [A, R, B, r])
  await sleep(400)
  const circles = JSON.parse(await sketchNow()).entities.filter((e) => e.kind === 'circle')
  check(circles.length === 2, `two circles on a sketch with no scan (${circles.length})`)
  const before = await sketchNow()

  // ---- Measure opens on the Sketch way --------------------------------------------
  await click(page, '[data-test=sketch-tool-line]')
  await click(page, '[data-test=snap-endpoint]')
  await analysisTab()
  check(await page.$eval('[data-test=ribbon-measure]', (el) => !el.disabled), 'with a sketch and no scan, Analysis → Measure can be pressed')
  await click(page, '[data-test=ribbon-measure]')
  await page.waitForSelector('[data-test=measure-dialog]')
  check(await page.$eval('[data-test=snap-endpoint]', el => el.getAttribute('aria-pressed')) === 'false', 'Automatic Measure inherits End off in Edit Sketch')
  // This regression exercises the explicit Sketch option; the separate
  // adaptive test covers the new workspace-independent default.
  await click(page, '[data-test=measure-plugin-sketch]')
  await page.waitForSelector('[data-test=sketch-editor]'); await sleep(600)
  const ways = await page.evaluate(() => Object.fromEntries(['3d', 'extended', 'point', 'plugin-sketch'].map((k) => {
    const b = document.querySelector(`[data-test=measure-${k}]`)
    return [k, { disabled: b?.disabled, pressed: b?.getAttribute('aria-pressed') }]
  })))
  check(ways['3d'].disabled && ways.extended.disabled && ways.point.disabled, `the mesh's ways are greyed with no scan (${JSON.stringify(ways)})`)
  check(ways['plugin-sketch'].pressed === 'true' && !ways['plugin-sketch'].disabled, `the explicit Sketch way remains available (${JSON.stringify(ways['plugin-sketch'])})`)
  check(await page.$eval('[data-test=snap-endpoint]', el => el.getAttribute('aria-pressed')) === 'false', 'Sketch Measure inherits End off in Edit Sketch')
  await click(page, '[data-test=snap-endpoint]')
  const head = await page.$eval('[data-test=measure-dialog] header', (el) => { const q = el.getBoundingClientRect(); return { x: q.left + 40, y: q.top + q.height / 2 } })
  await page.mouse.move(head.x, head.y); await page.mouse.down(); await page.mouse.move(head.x - 265, head.y + 20, { steps: 8 }); await page.mouse.up(); await sleep(200)
  // With no scan the sheet opens close in: wheel out over the view until
  // both circles, and a margin, are on the canvas clear of the panels.
  const visible = async (p) => { const q = await onSheet(p); return q && page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName === 'CANVAS', q) }
  const corners = [[A[0] - R - 3, A[1] - R - 3], [A[0] - R - 3, B[1] + R + 3], [B[0] + R + 3, A[1] - R - 3], [B[0] + R + 3, B[1] + R + 3]]
  for (let i = 0; i < 25; i++) {
    if ((await Promise.all(corners.map(visible))).every(Boolean)) break
    const mid = await onSheet([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2])
    const box0 = await page.$eval('.desktop-mid canvas', (el) => { const q = el.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 } })
    const at0 = mid && await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName === 'CANVAS', mid) ? mid : box0
    await page.mouse.move(at0.x, at0.y); await page.mouse.wheel({ deltaY: 240 }); await sleep(250)
  }
  check((await Promise.all(corners.map(visible))).every(Boolean), `both circles fit on the view (${JSON.stringify(await Promise.all(corners.map(onSheet)))})`)

  // ---- the snap bar: Smart Dimension's Pick switches -------------------------------
  const bar = await page.evaluate(() => {
    const b = document.querySelector('[data-test=snap-bar]')
    return { context: b?.dataset.context, keys: [...(b?.querySelectorAll('.snapkey') ?? [])].map((k) => k.dataset.test) }
  })
  check(bar.context === 'sketchPick' && bar.keys.includes('snap-quadrant') && bar.keys.includes('snap-center') && !bar.keys.includes('snap-scan'), `the snap bar shows the Pick switches while the Sketch way is chosen (${JSON.stringify(bar)})`)

  // ---- preview before a click -----------------------------------------------------
  await hoverAt(await onSheet([A[0] + R * Math.cos(0.6), A[1] + R * Math.sin(0.6)]))
  let pv = await preview()
  check(pv.outlines >= 1 && /^R 3\.0000/.test(pv.label ?? ''), `the cursor on A's rim lights the circle and shows R 3 before a click (${JSON.stringify(pv)})`)
  check((await readouts()).length === 0, 'and nothing is measured until the click')
  await page.screenshot({ path: shotPath('01-hover-rim.png') })
  await hoverAt(await onSheet([A[0] - 1.2, A[1] + 0.4]))
  pv = await preview()
  check(pv.label === null && pv.outlines === 1 && pv.points === 0, `inside the circle, away from its rim, the disc is a closed loop: outlined, no figure until the click (${JSON.stringify(pv)})`)

  // A's centre clicked, then B's centre previewed: the pair's figure before its click.
  await clickAt(await onSheet(A))
  check((await readouts()).length === 1, 'the first pick is listed')
  await hoverAt(await onSheet(B))
  pv = await preview()
  const want = Math.hypot(15, 2).toFixed(4)
  check((pv.label ?? '').includes(want) && pv.points >= 2, `with A's centre picked, the cursor on B's centre previews √229 = ${want} (${JSON.stringify(pv)})`)
  check((await readouts()).length === 1, 'and the pair is not measured until the click')
  await page.screenshot({ path: shotPath('02-hover-pair.png') })
  await clickAt(await onSheet(B))
  const titles = await readouts()
  check(titles.length === 2 && /→/.test(titles[0]), `the click measures the pair (${JSON.stringify(titles)})`)
  // Off the view, the preview goes.
  const box = await page.$eval('[data-test=measure-dialog]', (el) => { const q = el.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height - 20 } })
  await page.mouse.move(box.x, box.y, { steps: 4 }); await sleep(250)
  pv = await preview()
  check(pv.label === null && pv.outlines === 0 && pv.points === 0, `over the dialog, no preview is drawn (${JSON.stringify(pv)})`)
  await click(page, '[data-test=measure-delete-all]'); await sleep(200)

  // ---- the switches decide what a click takes --------------------------------------
  // A quadrant square alone reads its circle (the Dimension tool's rule);
  // paired, it is the quadrant point — while Quad is on.
  const top = await onSheet([A[0], A[1] + R]), right = await onSheet([A[0] + R, A[1]])
  const chord = (R * Math.SQRT2).toFixed(4)
  await clickAt(top)
  await hoverAt(right)
  pv = await preview()
  check((pv.label ?? '').includes(chord), `with Quad on and A's top quadrant picked, A's right quadrant previews the chord 3√2 = ${chord} (${JSON.stringify(pv)})`)
  await clickAt(right)
  let t = await readouts()
  check(/quadrant/i.test(t[0] ?? ''), `and the click measures quadrant to quadrant (${t[0]})`)
  await click(page, '[data-test=measure-delete-all]'); await sleep(200)
  await click(page, '[data-test=snap-quadrant]'); await sleep(300)
  check(await page.$eval('[data-test=snap-quadrant]', (el) => el.getAttribute('aria-pressed') === 'false'), 'Quad switched off on the bar')
  await clickAt(top)
  await hoverAt(right)
  pv = await preview()
  check(!(pv.label ?? '').includes(chord) && /^R 3\.0000/.test(pv.label ?? '') && pv.outlines >= 1, `with Quad off, the same two spots are the circle twice: the second previews the circle again, not a chord or a zero (${JSON.stringify(pv)})`)
  await clickAt(right)
  t = await readouts()
  check(t.length === 2 && t.every((x) => /circle/i.test(x) && !/quadrant|→/.test(x)), `and the click takes the circle by itself again, not a quadrant point nor the circle against itself (${JSON.stringify(t)})`)
  await click(page, '[data-test=snap-quadrant]'); await sleep(200)
  await click(page, '[data-test=measure-delete-all]'); await sleep(200)

  check((await sketchNow()) === before, 'the sketch is unchanged by previewing and measuring it')
  // Two unequal parallel lines: midpoint distance is sqrt(41), whereas
  // carrier distance is 5. This detects a pick silently falling to the line.
  await click(page, '[data-test=measure-delete-all]')
  await re(() => window.__re.store.setState(s => {
    const d=s.sketchDraft, sk=d.sketch, id=sk.nextId
    return {sketchDraft:{...d,sketch:{...sk,nextId:id+2,entities:[...sk.entities,
      {id,kind:'line',a:[-8,0],b:[2,0]}, {id:id+1,kind:'line',a:[-1,5],b:[3,5]}]}}}
  }))
  await sleep(300)
  const withLines=await sketchNow()
  if(await page.$eval('[data-test=snap-midpoint]', e=>e.getAttribute('aria-pressed')!=='true')) await click(page,'[data-test=snap-midpoint]')
  await clickAt(await onSheet([-3,0])); await clickAt(await onSheet([1,5]))
  const midRead=await page.$eval('[data-test=measure-readout]', e=>({title:e.querySelector('b')?.textContent,values:[...e.querySelectorAll('[data-test=measure-row]')].map(r=>Number(r.dataset.value))}))
  check(midRead.values.some(v=>Math.abs(v-Math.sqrt(41))<1e-8) && /mid|middle/i.test(midRead.title??''), `Mid on measures the two midpoints to 1e-8 mm, sqrt(41), rather than the carriers (${JSON.stringify(midRead)})`)
  check(await sketchNow()===withLines,'midpoint measurement leaves both lines and the other sketch geometry unchanged')
  await click(page,'[data-test=measure-delete-all]'); await click(page,'[data-test=snap-midpoint]')
  await clickAt(await onSheet([-3,0])); await clickAt(await onSheet([1,5]))
  const lineRead=await page.$eval('[data-test=measure-readout]', e=>({title:e.querySelector('b')?.textContent,values:[...e.querySelectorAll('[data-test=measure-row]')].map(r=>Number(r.dataset.value))}))
  check(lineRead.values.every(v=>Math.abs(v-Math.sqrt(41))>=1e-8) && !/mid|middle/i.test(lineRead.title??''), `Mid off does not silently retain midpoint picks (${JSON.stringify(lineRead)})`)
  await click(page,'[data-test=snap-midpoint]')
  await click(page, '[data-test=measure-close]'); await sleep(300)
  const after = await page.evaluate(() => ({ preview: document.querySelectorAll('[data-test=measure-preview-outline], [data-test=measure-preview-label]').length, bar: document.querySelector('[data-test=snap-bar]')?.dataset.context ?? null }))
  check(after.preview === 0 && after.bar !== 'measure', `closing Measure takes the preview away and gives the bar back (${JSON.stringify(after)})`)
} catch (error) { check(false, error.stack ?? error.message) }
await finish(browser, consoleErrors)
