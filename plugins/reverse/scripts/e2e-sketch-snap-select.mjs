// SPDX-License-Identifier: AGPL-3.0-only
// 1.2.20, by mouse and keyboard on the rendered sheet:
//  - relation glyphs and dimension numbers are not made anew as the mouse
//    moves, the wheel zooms or a corner is dragged, keep one stacking order,
//    and glyphs that mark one spot stand side by side;
//  - a dimension clicked with the arrow is selected, Delete removes it, a
//    double-click opens it;
//  - the snap bar at the bottom of the graphics window follows the tool, and
//    its Quadrant switch lets the Dimension tool take a circle's quadrant;
//  - a line that carries a length keeps it at every step while its end is
//    dragged.
import { writeFileSync } from 'node:fs'
import { check, click, finish, launchApp, loadScan, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { openReverse, reverseHelpers } from './lib.mjs'

const fixture = shotPath('snap-cylinder-r10.obj'), n = 96, obj = []
for (const z of [-5, 5]) for (let i = 0; i < n; i++) obj.push(`v ${10 * Math.cos(i * Math.PI * 2 / n)} ${10 * Math.sin(i * Math.PI * 2 / n)} ${z}`)
obj.push('v 0 0 -5', 'v 0 0 5')
for (let i = 0; i < n; i++) { const a = i + 1, b = (i + 1) % n + 1, c = a + n, d = b + n; obj.push(`f ${a} ${b} ${d}`, `f ${a} ${d} ${c}`, `f ${2 * n + 1} ${b} ${a}`, `f ${2 * n + 2} ${c} ${d}`) }
writeFileSync(fixture, obj.join('\n'))

const { browser, page, consoleErrors } = await launchApp({ width: 1500, height: 960, protocolTimeout: 600_000 })
const { re } = reverseHelpers(page)
const at = (point) => re((p) => window.__re.sheet().sheetScreenPoint(p), point)
const pointClick = async (p) => { const pixel = await at(p); await page.mouse.move(pixel.x, pixel.y); await sleep(100); await page.mouse.click(pixel.x, pixel.y); await sleep(180) }
const draft = () => re(() => { const d = window.__re.store.getState().sketchDraft; return { tool: d.tool, entities: d.sketch.entities, constraints: d.sketch.constraints, selectedConstraint: d.selectedConstraint, dimMade: d.dimMade ?? null, ok: d.report?.ok } })
const labels = () => page.evaluate(() => {
  window.__seen ??= new WeakMap(); window.__n ??= 0
  const tag = (el) => { if (!window.__seen.has(el)) window.__seen.set(el, ++window.__n); return window.__seen.get(el) }
  const row = (el) => { const r = el.getBoundingClientRect(); return { id: el.dataset.test, el: tag(el), x: Math.round(r.left), y: Math.round(r.top), z: el.style.zIndex } }
  return { notes: [...document.querySelectorAll('[data-test^=flat-note-]')].map(row), dims: [...document.querySelectorAll('[data-test^=flat-dimension-]')].map(row) }
})
const bar = () => page.evaluate(() => { const el = document.querySelector('[data-test=snap-bar]'); if (!el) return null; const r = el.getBoundingClientRect(); const stage = el.parentElement.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { context: el.dataset.context, fromLeft: Math.round(r.left - stage.left), right: Math.round(r.right), clear: (() => { const k = document.querySelector('.stagecorner')?.firstElementChild?.getBoundingClientRect(); return !k || k.left >= r.right || k.bottom <= r.top })(), fromBottom: Math.round(stage.bottom - r.bottom), onTop: el.contains(top), over: el.contains(top) ? '' : `${top?.tagName}.${top?.className} in ${top?.parentElement?.className}`, keys: Object.fromEntries([...el.querySelectorAll('button')].map((b) => [b.dataset.test, b.getAttribute('aria-pressed') === 'true'])) } })
try {
  await page.evaluate(() => localStorage.removeItem('scanruler.snapfilter'))
  await loadScan(page, fixture)
  await openReverse(page)
  if (await page.$('[data-test=support-card] .sc-x')) await click(page, '[data-test=support-card] .sc-x')
  check((await bar()) === null, 'no snap bar while no tool snaps')
  await re(() => {
    window.__re.store.getState().startSketch({ kind: 'world', axis: 'z', offset: 0 }, { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] })
    window.__re.store.setState((s) => ({ sketchDraft: { ...s.sketchDraft, placing: true } }))
  })
  await page.waitForSelector('[data-test=place-create]')
  if (await page.$eval('[data-test=tool-inspector]', (el) => el.dataset.mode === 'floating')) await click(page, '[data-test=toggle-inspector-dock]')
  await click(page, '[data-test=place-create]')
  await page.waitForSelector('[data-test=sketch-editor]'); await sleep(800)
  await click(page, '[data-test=sketch-tool-rectangle]'); await pointClick([-8, -4]); await pointClick([2, 4])
  let b = await bar()
  check(b && b.context === 'draw' && b.fromLeft === 12 && b.fromBottom === 12 && b.onTop && b.clear, `drawing: the snap bar stands in the bottom left-hand corner of the graphics window, clear of the view keys, on top (${JSON.stringify(b)})`)
  check(b && Object.keys(b.keys)[0] === 'snap-all' && b.keys['snap-all'] && b.keys['snap-quadrant'] && b.keys['snap-midpoint'], `All is the first switch and is on for drawing: every kind in play (${JSON.stringify(b?.keys)})`)
  await click(page, '[data-test=sketch-tool-circle]'); await pointClick([10, 0]); await pointClick([13, 0])
  // ---- All: the closest point is taken, and every point has its square -------
  await page.evaluate(() => { const v = window.__re.sheet(); const orig = v.setFlatDots.bind(v); v.setFlatDots = (dots) => { window.__dots = dots.map((d) => ({ at: d.at, color: d.color })); return orig(dots) } })
  await click(page, '[data-test=sketch-tool-line]'); await sleep(300)
  const circleNow = await re(() => window.__re.store.getState().sketchDraft.sketch.entities.find((e) => e.kind === 'circle'))
  const squares = await page.evaluate(() => (window.__dots ?? []).filter((d) => d.color === '#62aae4').map((d) => d.at))
  const hasSquare = (pt) => squares.some((q) => Math.hypot(q[0] - pt[0], q[1] - pt[1]) < 1e-6)
  const quad = [circleNow.c[0], circleNow.c[1] + circleNow.r], left = [circleNow.c[0] - circleNow.r, circleNow.c[1]]
  check(squares.length >= 8 && hasSquare(quad) && hasSquare(left), `with All on, the circle's four quadrant points and each line's middle wear a square (${squares.length} squares)`)
  const near = await at([quad[0] + 0.15, quad[1] + 0.12])
  await page.mouse.move(near.x, near.y); await sleep(120); await page.mouse.click(near.x, near.y); await sleep(200)
  await pointClick([quad[0] + 4, quad[1] + 5]); await page.keyboard.press('Escape'); await sleep(300)
  const fromQuad = await re(() => { const d = window.__re.store.getState().sketchDraft, l = d.sketch.entities.filter((e) => e.kind === 'line').at(-1); return { a: l.a, held: d.sketch.constraints.filter((c) => c.kind === 'coincident' && [c.p, c.q].some((x) => x.entity === l.id) && [c.p, c.q].some((x) => /^q[0-3]$/.test(x.at))).map((c) => [c.p.at, c.q.at]) } })
  check(Math.hypot(fromQuad.a[0] - quad[0], fromQuad.a[1] - quad[1]) < 1e-6 && fromQuad.held.length === 1, `a line begun a hair off the circle's top starts exactly on its 90° point and is held to it (${JSON.stringify(fromQuad)})`)
  await page.screenshot({ path: shotPath('00-all-squares.png') })
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control'); await sleep(300)
  await click(page, '[data-test=snap-all]'); await sleep(250)
  b = await bar()
  const fewer = await page.evaluate(() => (window.__dots ?? []).filter((d) => d.color === '#62aae4').length)
  check(!b.keys['snap-all'] && b.keys['snap-quadrant'] && b.keys['snap-midpoint'] && fewer === squares.length, `All off: the single switches stand as they were, every one on, the squares still there (${fewer})`)
  await click(page, '[data-test=snap-all]'); await sleep(200)
  await click(page, '[data-test=sketch-tool-select]')
  // Round figures, and an Equal on the two long sides: its glyph marks the
  // same spot as the bottom side's Horizontal.
  await re(() => {
    const s = window.__re.store.getState(), sk = structuredClone(s.sketchDraft.sketch)
    const sx = (v) => (Math.abs(v + 8) < Math.abs(v - 2) ? -8 : 2), sy = (v) => (v < 0 ? -4 : 4)
    sk.entities = sk.entities.map((e) => (e.kind === 'line' ? { ...e, a: [sx(e.a[0]), sy(e.a[1])], b: [sx(e.b[0]), sy(e.b[1])] } : e.kind === 'circle' ? { ...e, c: [10, 0], r: 3 } : e))
    const flat = sk.entities.filter((e) => e.kind === 'line' && e.a[1] === e.b[1])
    sk.constraints.push({ id: sk.nextId++, kind: 'equal', a: flat[0].id, b: flat[1].id })
    s.setSketch(sk)
  })
  await sleep(500)

  // ---- nothing is made anew or restacked by the mouse, the wheel or a drag --
  const first = await labels()
  const spots = new Set(first.notes.map((q) => `${q.x},${q.y}`))
  const ys = first.notes.map((q) => q.y), row = (y) => ys.filter((v) => v === y).length
  check(ys.every((y) => row(y) >= 2), `glyphs of level spots stand level, none lifted (${JSON.stringify(first.notes.map((q) => `${q.x},${q.y}`))})`)
  check(first.notes.length >= 9 && spots.size === first.notes.length, `every glyph has its own place on the screen: ${first.notes.length} glyphs, ${spots.size} places`)
  const sig = (l) => l.notes.map((q) => `${q.id}:${q.el}:${q.z}`).join(' ')
  const c = await at([0, 0])
  let same = true
  for (let i = 0; i <= 20; i++) { await page.mouse.move(c.x - 260 + i * 26, c.y - 150 + i * 15); await sleep(30); if (sig(await labels()) !== sig(first)) same = false }
  check(same, 'the mouse moved across the sheet: every glyph is the element it was, in the order it was')
  for (let i = 0; i < 6; i++) { await page.mouse.wheel({ deltaY: i < 3 ? -240 : 240 }); await sleep(150); if (sig(await labels()) !== sig(first)) same = false }
  check(same, 'zoomed in and out: the same elements, the same stacking order')
  const k = await at([2, 4])
  await page.mouse.move(k.x, k.y); await sleep(150); await page.mouse.down(); await sleep(80)
  for (let i = 1; i <= 8; i++) { await page.mouse.move(k.x + i * 3, k.y - i * 3); await sleep(50); if (sig(await labels()) !== sig(first)) same = false }
  await page.mouse.up(); await sleep(400)
  check(same, 'a corner dragged: the glyphs ride along, none taken off the page and put back')
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control'); await sleep(400)

  // ---- the Dimension tool and the bar's Quadrant switch ----------------------
  await click(page, '[data-test=sketch-dimension]'); await sleep(200)
  b = await bar()
  check(b && b.context === 'pick' && !b.keys['snap-all'] && b.keys['snap-quadrant'] && b.keys['snap-midpoint'] && b.keys['snap-center'], `Dimension: the bar shows the Pick switches, every point on (${JSON.stringify(b?.keys)})`)
  check((await page.evaluate(() => (window.__dots ?? []).filter((d) => d.color === '#62aae4').length)) >= 8, 'and the quadrant points and the middles wear their squares without anything being switched on')
  await click(page, '[data-test=snap-quadrant]'); await sleep(200)
  // Quadrant off: the circle's left-most point is the circle — its diameter.
  await pointClick([7, 0])
  let d = await draft()
  check(d.dimMade !== null && d.constraints.find((x) => x.id === d.dimMade)?.kind === 'diameter', 'Quadrant off: a click on the rim at 180° is the circle, its diameter in hand')
  await page.keyboard.press('Escape'); await sleep(200)
  await click(page, '[data-test=snap-quadrant]'); await sleep(200)
  check((await bar()).keys['snap-quadrant'] === true && (await draft()).tool === 'dimension', 'Quadrant switched on in the bar; the tool stays in hand')
  check((await page.evaluate(() => (window.__dots ?? []).filter((d) => d.color === '#62aae4').length)) >= 8, 'and the circle wears its four quadrant squares again, beside the middles')
  const q = await at([7, 0])
  await page.mouse.move(q.x + 2, q.y + 1); await sleep(200)
  await page.screenshot({ path: shotPath('01-quadrant-hover.png') })
  await page.mouse.click(q.x + 2, q.y + 1); await sleep(200)
  await pointClick([2, 1.5])
  d = await draft()
  const made = d.constraints.find((x) => x.id === d.dimMade)
  check(made?.kind === 'distance' && made.p?.at === 'q2' && Math.abs(made.value - 5) < 1e-3, `Quadrant on: the 180° point then the rectangle's side is the 5 mm between them (${JSON.stringify(made)})`)
  await pointClick([5, 7])
  await page.waitForSelector(`[data-test="flat-dimension-${made.id}"] input`)
  await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await page.keyboard.type('4'); await page.keyboard.press('Enter'); await sleep(500)
  d = await draft()
  const circle = d.entities.find((e) => e.kind === 'circle'), side = d.entities.filter((e) => e.kind === 'line').map((e) => Math.max(e.a[0], e.b[0])).reduce((m, v) => Math.max(m, v), -Infinity)
  check(d.ok && Math.abs(circle.c[0] - circle.r - side - 4) < 1e-5, `4 typed: the circle's edge stands 4 mm from the side (${(circle.c[0] - circle.r - side).toFixed(6)})`)
  await page.screenshot({ path: shotPath('02-quadrant-dimension.png') })

  // ---- a dimension selected with the arrow, deleted, undone, opened ----------
  await click(page, '[data-test=sketch-tool-select]'); await sleep(300)
  const label = `[data-test="flat-dimension-${made.id}"]`
  await page.click(label); await sleep(700)
  const sel = await page.evaluate((s) => { const el = document.querySelector(s); return { selected: el?.classList.contains('selected'), input: !!el?.querySelector('input'), color: el ? getComputedStyle(el.querySelector('.label-value')).color : null } }, label)
  d = await draft()
  check(sel.selected && !sel.input && d.selectedConstraint === made.id, `a click on the number selects the dimension and opens no field (${JSON.stringify(sel)})`)
  await page.screenshot({ path: shotPath('03-dimension-selected.png') })
  await page.keyboard.press('Delete'); await sleep(400)
  d = await draft()
  check(!d.constraints.some((x) => x.id === made.id) && (await page.$(label)) === null, 'Delete removes it, from the sketch and from the sheet')
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control'); await sleep(500)
  check((await draft()).constraints.some((x) => x.id === made.id), 'Undo puts it back')
  await page.click(label, { count: 2 }); await sleep(400)
  check((await page.$(`${label} input`)) !== null, 'a double-click opens the number for typing')
  await page.keyboard.press('Escape'); await sleep(200)

  // ---- a line with a length, its end dragged --------------------------------
  await click(page, '[data-test=sketch-tool-line]'); await pointClick([-7, 9]); await pointClick([-1.5, 9]); await page.keyboard.press('Escape')
  await click(page, '[data-test=sketch-dimension]'); await pointClick([-4, 9]); await pointClick([-4, 11])
  d = await draft()
  const lengthDim = d.constraints.findLast((x) => x.kind === 'length')
  await page.waitForSelector(`[data-test="flat-dimension-${lengthDim.id}"] input`)
  await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await page.keyboard.type('8'); await page.keyboard.press('Enter'); await sleep(400)
  await click(page, '[data-test=sketch-tool-select]'); await sleep(200)
  const lineId = lengthDim.entity
  const line = () => re((id) => { const e = window.__re.store.getState().sketchDraft.sketch.entities.find((x) => x.id === id); return { a: e.a, b: e.b, length: Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) } }, lineId)
  const before = await line()
  const end = before.a[0] > before.b[0] ? before.a : before.b
  const p0 = await at(end)
  const dimEl = await page.evaluate((s) => { window.__dimEl = document.querySelector(s); return !!window.__dimEl }, `[data-test="flat-dimension-${lengthDim.id}"]`)
  await page.mouse.move(p0.x, p0.y); await sleep(150); await page.mouse.down(); await sleep(80)
  let worst = 0, lag = 0, texts = new Set(), kept = true
  for (let i = 1; i <= 24; i++) {
    const hand = { x: p0.x + i * 5, y: p0.y - i * 7 }
    await page.mouse.move(hand.x, hand.y); await sleep(45)
    const now = await line()
    worst = Math.max(worst, Math.abs(now.length - 8))
    const tip = await at(before.a[0] > before.b[0] ? now.a : now.b)
    lag = Math.max(lag, Math.hypot(tip.x - hand.x, tip.y - hand.y))
    const t = await page.evaluate((s) => { const el = document.querySelector(s); return { text: el?.textContent ?? '', same: el === window.__dimEl } }, `[data-test="flat-dimension-${lengthDim.id}"]`)
    texts.add(t.text); if (!t.same) kept = false
  }
  await page.screenshot({ path: shotPath('04-dimensioned-line-dragged.png') })
  await page.mouse.up(); await sleep(500)
  const after = await line()
  check(dimEl && worst < 1e-3, `dragged through 24 steps the line is 8 mm long at every one (worst off by ${worst.toExponential(2)} mm)`)
  // The drag is drawn once a frame: read between frames the end may be one
  // 8.6 px mouse step behind, never more.
  check(lag < 9, `and its end stays under the hand, within one mouse step (furthest ${lag.toFixed(1)} px behind)`)
  const lifted = await page.evaluate(() => [...document.querySelectorAll('[data-test^=flat-note-], [data-test^=flat-dimension-]')].filter((el) => el.style.top !== '' && el.style.top !== '0px').length)
  check(lifted === 0, `no glyph and no number is lifted off its place by the label spreader (${lifted})`)
  check(texts.size === 1 && kept, `its number reads the same throughout and is the one label (${[...texts].join(' | ')})`)
  check(Math.abs(after.length - 8) < 1e-6 && Math.hypot(after.b[0] - before.b[0], after.b[1] - before.b[1]) + Math.hypot(after.a[0] - before.a[0], after.a[1] - before.a[1]) > 1, `let go: 8 mm exactly, and moved (${after.length.toFixed(9)})`)
  writeFileSync(shotPath('snap-select-results.json'), JSON.stringify({ worst, lag, after }, null, 2))
} catch (error) { check(false, error.stack ?? error.message) }
await finish(browser, consoleErrors)
