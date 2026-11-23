// SPDX-License-Identifier: AGPL-3.0-only
// End-to-end test of the hands-on round of 2026-09-21 in the Reverse engineer
// workspace, on the blank stage: an extrude's ends put through points clicked
// on the part, in front of the sketch plane and behind it; the ghost following
// a grip's drag frame by frame; a new solid never offered a surface to join;
// the rollback bar dragged up the feature list, an edit refused while it is
// up (the model is only looked at), and To end building the rest again; a rectangle drawn past the card the sheet
// is framed by; and the prompt that walks Symmetric through its three picks.
//
// Prereqs: dev server running (npm run dev), Chrome installed.
//   node plugins/reverse/scripts/e2e-reverse-history.mjs
// Env: CHROME (chrome.exe path), APP_URL, SHOT_DIR.
import { check, click, drag, finish, launchApp, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { openReverse, reverseHelpers } from './lib.mjs'

const { browser, page, consoleErrors } = await launchApp({ width: 1600, height: 1000, protocolTimeout: 600_000 })
const { re, built, screen } = reverseHelpers(page)
const XY = (z) => ({ origin: [0, 0, z], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] })

await openReverse(page)

// ---- the block: 40 × 20 × 10 ------------------------------------------------------------
await re((frame) => {
  const s = () => window.__re.store.getState()
  s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, frame)
  s().setSketchTool('rectangle')
  s().sketchClick([0, 0], 0.01, false, { off: true })
  s().sketchClick([40, 20], 0.01, false, { off: true })
  const id = s().commitSketch()
  s().startExtrude(id)
  if (s().extrudeDraft.regions.length === 0) s().pickAllDraftRegions()
  // 10 mm, said: the default depth is measured from the profile (1.1.x).
  s().setExtrude({ extent: { kind: 'distance', from: 0, to: 10 } })
  s().commitExtrude()
}, XY(0))
await built()
await re(() => window.__re.scene().frameAll())
await sleep(800)

/** A point of the part as client pixels. */
const status = () => page.$eval('footer.strip', (el) => el.textContent).catch(() => '')

// ---- an extrude's ends through points on the part ------------------------------------------
// A small profile on a plane 4 mm up inside the block, so the block's top is
// in front of the plane and its bottom behind it.
await re((frame) => {
  const s = () => window.__re.store.getState()
  s().startSketch({ kind: 'world', axis: 'z', offset: 4 }, frame)
  s().setSketchTool('rectangle')
  s().sketchClick([4, 4], 0.01, false, { off: true })
  s().sketchClick([10, 10], 0.01, false, { off: true })
  const id = s().commitSketch()
  s().startExtrude(id)
  if (s().extrudeDraft.regions.length === 0) s().pickAllDraftRegions()
}, XY(4))
await page.waitForSelector('[data-test=extrude-pick-hint]')
// The top face, well clear of the profile.
let [x, y] = await screen([34, 14, 10])
await page.mouse.click(x, y)
await sleep(400)
let extent = await re(() => window.__re.store.getState().extrudeDraft.extent)
check(extent.kind === 'distance' && extent.from === 0 && Math.abs(extent.to - 6) < 0.011, `a click on the block's top face puts To at its height over the sketch plane, 6 mm (${JSON.stringify(extent)})`)
console.log('status:', await status())
// The other end, behind the plane: a corner of the block's bottom clicked
// sets From, To staying where the first click put it.
;[x, y] = await screen([40, 20, 0])
await page.mouse.click(x, y)
await sleep(400)
extent = await re(() => window.__re.store.getState().extrudeDraft.extent)
check(extent.kind === 'distance' && Math.abs(extent.from + 4) < 1e-9 && Math.abs(extent.to - 6) < 0.011, `From goes to a corner clicked behind the sketch plane, −4 mm, and To stays (${JSON.stringify(extent)})`)
// The same two points the other way round make the same body.
await re(() => window.__re.store.getState().setExtrude({ extent: { kind: 'distance', from: 0, to: 10 } }))
await page.mouse.click(x, y)
await sleep(400)
;[x, y] = await screen([34, 14, 10])
await page.mouse.click(x, y)
await sleep(400)
extent = await re(() => window.__re.store.getState().extrudeDraft.extent)
check(extent.kind === 'distance' && Math.abs(extent.from + 4) < 1e-9 && Math.abs(extent.to - 6) < 0.011, `the bottom first, then the top: the same body (${JSON.stringify(extent)})`)
await page.screenshot({ path: shotPath('reverse-history-extrude-point.png') })

// ---- the ghost under a grip's drag -----------------------------------------------------------
// Twenty moves a frame apart, and the ghost's far face read after each: it
// is where the number says, move for move — not where the kernel last left it.
await re(() => window.__re.store.getState().setExtrude({ extent: { kind: 'distance', from: 0, to: 6 } }))
await page.waitForFunction(() => window.__re.store.getState().preview.status === 'ok', { timeout: 30_000 })
const follow = await re(async () => {
  const s = () => window.__re.store.getState()
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const top = () => {
    const ghost = window.__re.reScene().bodyPreview
    if (!ghost) return NaN
    ghost.geometry.computeBoundingBox()
    const b = ghost.geometry.boundingBox
    const m = ghost.matrixAutoUpdate ? null : ghost.matrix.elements
    let best = -Infinity
    for (const px of [b.min.x, b.max.x]) for (const py of [b.min.y, b.max.y]) for (const pz of [b.min.z, b.max.z]) {
      const z = m ? m[2] * px + m[6] * py + m[10] * pz + m[14] : pz
      if (z > best) best = z
    }
    return best
  }
  s().gripDrag('extrudeTo', 0, 'start')
  let kept = 0
  const misses = []
  for (let i = 1; i <= 20; i++) {
    s().gripDrag('extrudeTo', i * 0.7, 'move')
    await frame()
    const want = 4 + s().extrudeDraft.extent.to
    const got = top()
    if (Math.abs(got - want) < 0.05) kept++
    else misses.push([i, got, want])
  }
  s().gripDrag('extrudeTo', 14, 'end')
  return { kept, misses }
})
check(follow.kept >= 19, `the ghost's far face is where the dragged number says on ${follow.kept} of 20 frames (${JSON.stringify(follow.misses.slice(0, 3))})`)
await page.waitForFunction(() => window.__re.store.getState().preview.status === 'ok', { timeout: 30_000 })
const settled = await re(() => ({ to: window.__re.store.getState().extrudeDraft.extent.to, auto: window.__re.reScene().bodyPreview?.matrixAutoUpdate }))
check(settled.to === 20 && settled.auto === true, `let go, the kernel's own ghost stands there, unstretched (${JSON.stringify(settled)})`)
await re(() => {
  const s = () => window.__re.store.getState()
  s().setExtrude({ extent: { kind: 'distance', from: 0, to: 12 }, op: 'join' })
  s().commitExtrude()
})
await built()
await sleep(300)

// ---- a solid is never offered a surface to join -------------------------------------------------
await re((frame) => {
  const s = () => window.__re.store.getState()
  s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, frame)
  s().setSketchTool('line')
  s().sketchClick([20, -5], 0.01, false, { off: true })
  s().sketchClick([20, 25], 0.01, false, { off: true })
  s().setSketchTool('select')
  const id = s().commitSketch()
  s().startFeature('sheet', { sketchId: id, from: -2, to: 14 })
  s().commitFeature()
}, XY(0))
await page.waitForFunction(() => !window.__re.store.getState().building && window.__re.store.getState().bodies.some((b) => b.surface), { timeout: 60_000 })
const joinDefault = await re(() => {
  const s = () => window.__re.store.getState()
  const sketch = s().features.find((f) => f.kind === 'sketch').id
  s().startExtrude(sketch)
  const d = s().extrudeDraft
  return { op: d.op, target: 'target' in d, last: s().bodies.at(-1) }
})
check(joinDefault.last.surface === true && joinDefault.op === 'join' && !joinDefault.target, `with a sheet the last body made, a new extrude joins what it meets — no body to choose (${JSON.stringify(joinDefault)})`)
await page.waitForSelector('[data-test=extrude-op]')
const results = await page.$$eval('[data-test=extrude-op] option', (os) => os.map((o) => o.textContent.trim()))
check(JSON.stringify(results) === JSON.stringify(['New Solid', 'Combine (Join)', 'Cut']) && !(await page.$('[data-test=extrude-target]')), `the box offers Join, Cut and New body and no body list (${results.join(' | ')})`)
await click(page, '[data-test=extrude-cancel]')
// The box opening scrolled the panel up to it, smoothly: the rows are
// measured once it has come to rest.
await page.waitForFunction(() => !document.querySelector('[data-test=extrude-editor]'), { timeout: 10_000 })
await sleep(800)

// ---- the rollback bar ----------------------------------------------------------------------------
const rowsBefore = await page.$$eval('[data-test=feature-row]', (r) => r.length)
check(rowsBefore === 6 && (await page.$('[data-test=rollback-bar]')) !== null, `six features, and the rollback bar under them (${rowsBefore})`)
// The list is scrolled to the bar first, as a hand would: the panel's
// list runs past the bottom of the window. Then dragged up to between the
// second row and the third.
await page.$eval('[data-test=rollback-bar]', (el) => el.scrollIntoView({ block: 'center' }))
await sleep(400)
const rects = await page.$$eval('[data-test=feature-row]', (rows) => rows.map((r) => { const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, top: b.top, bottom: b.bottom } }))
const bar = await page.$eval('[data-test=rollback-bar] .grip', (el) => { const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })
await drag(page, [bar.x, bar.y], [bar.x, (rects[1].bottom + rects[2].top) / 2], { steps: 12 })
await page.waitForFunction(() => !window.__re.store.getState().building, { timeout: 60_000 })
await sleep(400)
let rolled = await re(() => ({ head: window.__re.store.getState().features.map((f) => f.name), tail: window.__re.store.getState().rolledBack.map((f) => f.name), bodies: window.__re.store.getState().bodies.map((b) => b.name) }))
check(rolled.head.length === 2 && rolled.tail.length === 4 && rolled.bodies.length === 1, `the bar dragged under the second row sets four features aside and the part stands as it stood there (${JSON.stringify(rolled)})`)
check((await page.$$eval('[data-test=feature-row-rolled]', (r) => r.length)) === 4, 'the features below the bar are listed, set aside')
await page.screenshot({ path: shotPath('reverse-history-rolled.png') })
// Rolled back, the model is only looked at (since History's common End of
// Model): a fillet asked for at the bar is refused with the reason, and
// nothing is added. The bar is the History panel's End of Model.
const endMark = await page.evaluate(() => document.querySelector('[data-test=history-end-marker], [data-test=history-end]')?.textContent ?? null)
await re(() => {
  const s = () => window.__re.store.getState()
  const body = s().bodies[0].id
  const edge = window.__re.topology(body).edges.find((e) => e.fingerprint.kind === 'line' && Math.abs(e.fingerprint.length - 10) < 1e-6)
  s().startFeature('fillet')
  if (s().featureDraft) {
    s().toggleDraftEdge(body, edge)
    s().setFeatureDraft({ radius: 2, radiusTyped: true, chain: false })
    s().commitFeature()
  }
})
await sleep(1500)
const refused = await page.evaluate(() => ({ status: document.querySelector('footer.strip')?.textContent ?? '', features: window.__re.store.getState().features.length, draft: window.__re.store.getState().featureDraft !== null }))
check(/The model is rolled back. Move End of Model to the end before creating, editing or deleting geometry./.test(refused.status) && refused.features === 2 && !refused.draft, `rolled back, a fillet is refused with the reason and nothing is added (${JSON.stringify({ ...refused, status: refused.status.slice(0, 140), endMark })})`)
const tip = await page.$eval('[data-test=rollback-bar]', (el) => el.title)
check(/nothing can be made, changed or deleted until the bar is back at the end/.test(tip) && !/add one earlier/.test(tip), `the bar's tooltip says the rolled-back model is only looked at (${tip})`)
// The tools are off while rolled back, and an inert ribbon or panel cannot
// say why: a strip under the ribbon says it, and the panel's lock line,
// each with To End of Model (1.2.12). The panel's own To end, which could
// not be pressed, is gone.
const seenAt = (sel) => page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.width > 0 && Boolean(h && (h === el || el.contains(h))) }).catch(() => false)
const strip = { text: await page.$eval('[data-test=model-rolled-bar]', (el) => el.textContent).catch(() => null), key: await seenAt('[data-test=model-rolled-to-end]'), panelKey: await seenAt('[data-test=model-history-to-end]'), deadKey: (await page.$('[data-test=rollback-end]')) !== null }
check(/The model is rolled back/.test(strip.text ?? '') && strip.key && strip.panelKey && !strip.deadKey, `rolled back, a strip under the ribbon and the panel's lock line say why, each with To End of Model, on screen (${JSON.stringify(strip)})`)
await page.screenshot({ path: shotPath('reverse-history-rolled-strip.png') })
await click(page, '[data-test=model-rolled-to-end]')
await page.waitForFunction(() => !window.__re.store.getState().building && window.__re.store.getState().rolledBack.length === 0, { timeout: 60_000 })
check((await page.$('[data-test=model-rolled-bar]')) === null, 'at End of Model the strip goes')
await sleep(500)
rolled = await re(() => {
  const s = window.__re.store.getState()
  return { kinds: s.features.map((f) => f.kind), failed: Object.values(s.results).filter((r) => r.status === 'failed').map((r) => r.message), volume: s.bodies.find((b) => !b.surface).volume }
})
check(rolled.kinds.join(',') === 'sketch,extrude,sketch,extrude,sketch,sheet', `To end builds the six features again (${rolled.kinds.join(',')})`)
// The block plus the boss above it (6 × 6 × 6 stands proud of z = 10).
const want = 40 * 20 * 10 + 6 * 6 * 6
check(rolled.failed.length === 0 && Math.abs(rolled.volume - want) < 0.5, `every feature builds, and the body is the block with its boss (${rolled.volume.toFixed(2)} of ${want.toFixed(2)} mm³; ${rolled.failed.join('; ')})`)

// ---- a rectangle past the card the sheet is framed by ---------------------------------------------
await re((frame) => window.__re.store.getState().startSketch({ kind: 'world', axis: 'z', offset: 30 }, frame), XY(30))
await page.waitForSelector('.viewslot.sketch canvas')
await sleep(1500)
await click(page, '[data-test=sketch-tool-rectangle]')
// The floating Edit Sketch panel stands over the view's left side: the
// first corner goes just clear of it.
const slot = await page.$eval('.viewslot.sketch', (el) => { const b = el.getBoundingClientRect(); const p = document.querySelector('[data-test=tool-inspector]:not([hidden])')?.getBoundingClientRect(); return { left: Math.max(b.left, p && p.right < b.right - 200 ? p.right : b.left), right: b.right, top: b.top, bottom: b.bottom } })
await page.mouse.click(slot.left + 40, slot.top + (slot.bottom - slot.top) * 0.4)
await sleep(200)
await page.mouse.click(slot.right - 40, slot.top + (slot.bottom - slot.top) * 0.6)
await sleep(500)
const wide = await re(() => {
  const d = window.__re.store.getState().sketchDraft
  const xs = d.sketch.entities.flatMap((e) => (e.kind === 'line' ? [e.a[0], e.b[0]] : []))
  const sheet = window.__re.sheet()
  return { lines: d.sketch.entities.filter((e) => e.kind === 'line').length, width: Math.max(...xs) - Math.min(...xs), card: sheet.bounds.x1 - sheet.bounds.x0 }
})
check(wide.lines === 4 && wide.width > wide.card, `a rectangle clicked at the two ends of the viewport is drawn, wider than the sheet's card (${wide.width.toFixed(1)} mm against ${wide.card.toFixed(1)} mm)`)
await page.screenshot({ path: shotPath('reverse-history-wide-rectangle.png') })

// ---- Symmetric says what it wants next ------------------------------------------------------------
await click(page, '[data-test=sketch-rel-symmetric]')
const hintText = () => page.$eval('[data-test=sketch-hint]', (el) => el.textContent).catch(() => '')
check(/first of the two pieces/.test(await hintText()), `Symmetric in hand asks for the first piece (${await hintText()})`)
const sym = await re(() => {
  const s = () => window.__re.store.getState()
  const lines = s().sketchDraft.sketch.entities.filter((e) => e.kind === 'line')
  // The rectangle's two upright sides, then a mirror line drawn between them.
  const upright = lines.filter((l) => Math.abs(l.a[0] - l.b[0]) < 1e-6)
  const mid = (l) => [(l.a[0] + l.b[0]) / 2, (l.a[1] + l.b[1]) / 2]
  s().sketchClick(mid(upright[0]), 0.5, false)
  return { second: mid(upright[1]), x: (upright[0].a[0] + upright[1].a[0]) / 2, y: mid(upright[0])[1] }
})
check(/mirrors it/.test(await hintText()), `then for the piece that mirrors it (${await hintText()})`)
await re((p) => window.__re.store.getState().sketchClick(p, 0.5, false), sym.second)
await sleep(200)
check(/line they mirror about/.test(await hintText()), `then for the mirror line (${await hintText()})`)
const made = await re((at) => {
  const s = () => window.__re.store.getState()
  // The mirror line, a little off the middle, drawn with the relation put down and taken up again.
  s().setSketchTool('line')
  s().sketchClick([at.x + 3, at.y - 40], 0.01, false, { off: true })
  s().sketchClick([at.x + 3, at.y + 40], 0.01, false, { off: true })
  s().setSketchTool('select')
  const lines = s().sketchDraft.sketch.entities.filter((e) => e.kind === 'line')
  const axis = lines.at(-1)
  const upright = lines.filter((l) => l.id !== axis.id && Math.abs(l.a[0] - l.b[0]) < 1e-6)
  s().armRelation('symmetric')
  const mid = (l) => [(l.a[0] + l.b[0]) / 2, (l.a[1] + l.b[1]) / 2]
  s().sketchClick(mid(upright[0]), 0.5, false)
  s().sketchClick(mid(upright[1]), 0.5, false)
  s().sketchClick([axis.a[0], at.y + 35], 0.5, false)
  const d = s().sketchDraft
  const now = d.sketch.entities
  const ax = now.find((e) => e.id === axis.id)
  const [l, r] = upright.map((u) => now.find((e) => e.id === u.id))
  return { count: d.sketch.constraints.filter((c) => c.kind === 'symmetric').length, error: d.error, off: Math.abs((l.a[0] + r.a[0]) / 2 - ax.a[0]), ok: d.report?.ok }
}, sym)
check(made.count === 2 && made.error === null && made.off < 1e-4, `two sides and a line make them mirror images about it: the line ends up midway between them (${JSON.stringify(made)})`)
await page.screenshot({ path: shotPath('reverse-history-symmetric.png') })

await finish(browser, consoleErrors)
