// SPDX-License-Identifier: AGPL-3.0-only
// Stacked sections' box, used as a person would: 2D Sketch from the ribbon,
// the plane and offset typed in the panel, Stacked sections ticked, then the
// box's handles dragged with the mouse — a side in, a corner out, the centre
// across — with the cuts, the tint and the handles checked after each, an
// orbit on empty space left alone by the box, Outline Mesh inside a narrow
// box, and the handles gone with the stack.
import { writeFileSync } from 'node:fs'
import { check, click, finish, launchApp, loadScan, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'

// A stepped block: z −10..0 is 20 × 10 mm, z 0..10 is 12 × 6 mm, closed.
const fixture = shotPath('stack-box-step.obj'), lines = [], rings = [{ z: -10, x: 10, y: 5 }, { z: 0, x: 10, y: 5 }, { z: 0, x: 6, y: 3 }, { z: 10, x: 6, y: 3 }], perSide = 20, n = 4 * perSide
for (const { z, x, y } of rings) {
  const corners = [[-x, -y], [x, -y], [x, y], [-x, y]]
  corners.forEach((a, j) => { const b = corners[(j + 1) % 4]; for (let i = 0; i < perSide; i++) { const u = i / perSide; lines.push(`v ${a[0] * (1 - u) + b[0] * u} ${a[1] * (1 - u) + b[1] * u} ${z}`) } })
}
for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < n; i++) { const a = r * n + i + 1, b = r * n + (i + 1) % n + 1, c = a + n, d = b + n; lines.push(`f ${a} ${b} ${d}`, `f ${a} ${d} ${c}`) }
writeFileSync(fixture, lines.join('\n'))

const { browser, page, consoleErrors } = await launchApp({ width: 1500, height: 960, protocolTimeout: 600_000 })
page.on('dialog', (dialog) => dialog.accept())
const re = (fn, arg) => page.evaluate(fn, arg)
const stack = () => re(async () => { const { useStack } = await import('/plugins/reverse/state/stackStore.ts'); const s = useStack.getState(); return { on: s.on, upper: s.upper, lower: s.lower, rect: s.rect } })
const chains = () => re(() => window.__re.store.getState().sketchDraft?.sketch.referenceChains ?? null)
const settled = () => page.waitForFunction(() => !document.querySelector('[data-test=place-working]'), { timeout: 120_000 }).then(() => sleep(700))
/** Where a handle is on screen: by its kind (su, sv). */
const handleAt = (su, sv) => re(([su, sv]) => {
  const h = window.__re.reScene().stackHandlePositions().find((p) => p.kind.su === su && p.kind.sv === sv)
  return h ? window.__re.scene().screenPointOf(h.point) : null
}, [su, sv])
/** Where a point of the handles' plane (u, v in the sketch frame) is on screen. */
const planePointAt = (a, b) => re(async ([a, b]) => {
  const { useStack } = await import('/plugins/reverse/state/stackStore.ts')
  const d = window.__re.store.getState().sketchDraft, f = d.frame, offset = d.plane.offset ?? 0, h = (useStack.getState().upper + useStack.getState().lower) / 2 - offset
  const p = [0, 1, 2].map((k) => f.origin[k] + f.basisU[k] * a + f.basisV[k] * b + f.normal[k] * h)
  return window.__re.scene().screenPointOf(p)
}, [a, b])
/** A person's drag: press, move in steps, let go. */
const drag = async (from, to) => {
  await page.mouse.move(from.x, from.y); await sleep(250)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) { await page.mouse.move(from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12); await sleep(25) }
  await page.mouse.up(); await sleep(300)
}
const near = (a, b, tol) => Math.abs(a - b) <= tol
const extent = (cs) => { let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity; for (const c of cs) for (const [u, v] of c) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v) } return { u0, u1, v0, v1 } }

try {
  await loadScan(page, fixture)
  // 2D Sketch from the ribbon, (OXY), offset −8 typed and applied.
  await page.$$eval('button', (bs) => bs.find((b) => b.textContent.trim() === '2D Sketch' && b.offsetParent !== null)?.click())
  await page.waitForSelector('[data-test=place-plane-z]')
  await click(page, '[data-test=place-plane-z]'); await sleep(500)
  const off = await page.$('[data-test=place-offset]'); await off.click({ clickCount: 3 }); await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await off.type('-8')
  await click(page, '[data-test=place-offset-apply]'); await sleep(800)
  await click(page, '[data-test=place-stacked]')
  await page.waitForFunction(() => window.__re?.store.getState().sketchDraft?.sketch.referenceChains !== undefined, { timeout: 120_000 }); await settled()
  let s = await stack(), cs = await chains()
  check(s.on && s.rect && s.rect.u0 < -10 && s.rect.u1 > 10 && s.rect.v0 < -5 && s.rect.v1 > 5, `the box starts on the part's footprint, a little wider (${JSON.stringify(s.rect)})`)
  check(cs.length === 10, `10 cuts collected (${cs.length})`)
  const handles = await re(() => window.__re.reScene().stackHandlePositions().length)
  check(handles === 9, `nine handles: four corners, four sides, the centre (${handles})`)
  await page.screenshot({ path: shotPath('stack-box-1-start.png') })

  // The yellow arrow, at the box's centre on its lower plane, works as the
  // blue one does: dragged, it moves only the box's lower plane — the
  // sketch's plane and the upper plane stay put.
  const arrowGrip = (h, dir) => re(async ([h, dir]) => {
    const { useStack } = await import('/plugins/reverse/state/stackStore.ts')
    const d = window.__re.store.getState().sketchDraft, f = d.frame, r = useStack.getState().rect
    const at = (hh) => window.__re.scene().screenPointOf([0, 1, 2].map((k) => f.origin[k] + f.basisU[k] * (r.u0 + r.u1) / 2 + f.basisV[k] * (r.v0 + r.v1) / 2 + f.normal[k] * hh))
    const a = at(h), b = at(h + dir), len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    return { x: a.x + ((b.x - a.x) / len) * 14, y: a.y + ((b.y - a.y) / len) * 14 }
  }, [h, dir])
  const lowerBefore = (await stack()).lower, upperBefore = (await stack()).upper
  check(lowerBefore === -8, `the box's lower plane starts on the sketch's plane (${lowerBefore})`)
  const yellow = await arrowGrip(0, -1)
  await drag(yellow, { x: yellow.x, y: yellow.y - 60 }); await settled()
  const afterYellow = await stack(), sketchOffset = await page.$eval('[data-test=place-offset]', (e) => Number(e.value))
  cs = await chains()
  check(afterYellow.lower > lowerBefore + 1 && afterYellow.upper === upperBefore && sketchOffset === -8, `dragging the yellow arrow up moves the box's lower plane only (lower ${afterYellow.lower.toFixed(2)}, upper ${afterYellow.upper.toFixed(2)}, sketch offset ${sketchOffset})`)
  const lowerShown = await page.$eval('[data-test=place-stack-lower]', (e) => Number(e.value))
  check(Math.abs(lowerShown - (afterYellow.lower + 8)) < 0.01, `the panel shows the lower plane from the sketch plane (${lowerShown})`)
  await page.screenshot({ path: shotPath('stack-box-0-yellow-up.png') })
  // Back down, typed, for the checks that follow.
  const lowerField = await page.$('[data-test=place-stack-lower]'); await lowerField.focus(); await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await lowerField.type('0'); await page.keyboard.press('Tab'); await settled()
  check((await stack()).lower === -8, 'typing 0 puts the lower plane back on the sketch plane')

  // The sketch's own plane keeps an arrow while stacking — green, beside the
  // box — and snaps onto the middle section when dragged near it; the
  // Bottom / Middle / Top buttons put it on those sections.
  const sketchGrip = (dh) => re(async ([dh]) => {
    const { useStack } = await import('/plugins/reverse/state/stackStore.ts')
    const d = window.__re.store.getState().sketchDraft, f = d.frame, r = useStack.getState().rect
    const u = r.u1 + 0.12 * (r.u1 - r.u0), v = (r.v0 + r.v1) / 2
    const at = (h) => window.__re.scene().screenPointOf([0, 1, 2].map((k) => f.origin[k] + f.basisU[k] * u + f.basisV[k] * v + f.normal[k] * h))
    const a = at(0), b = at(1), len = Math.hypot(b.x - a.x, b.y - a.y) || 1, t = at(dh)
    return { grip: { x: a.x + ((b.x - a.x) / len) * 14, y: a.y + ((b.y - a.y) / len) * 14 }, by: { x: t.x - a.x, y: t.y - a.y } }
  }, [dh])
  {
    const st = await stack(), mid = (st.lower + st.upper) / 2
    const { grip, by } = await sketchGrip(mid - (-8) - 0.3)
    await drag(grip, { x: grip.x + by.x, y: grip.y + by.y }); await settled()
    const off = await re(() => window.__re.store.getState().sketchDraft.plane.offset)
    const after = await stack()
    check(Math.abs(off - mid) < 1e-9 && after.lower === st.lower && after.upper === st.upper, `dragging the green arrow to 0.3 mm short of the middle snaps the sketch's plane onto it (offset ${off}, middle ${mid}); the box stays put`)
    await page.screenshot({ path: shotPath('stack-box-0b-sketch-middle.png') })
    await click(page, '[data-test=place-stack-snap-top]'); await settled()
    check(Math.abs((await re(() => window.__re.store.getState().sketchDraft.plane.offset)) - st.upper) < 1e-9, 'Top puts the sketch plane on the top section')
    await click(page, '[data-test=place-stack-snap-bottom]'); await settled()
    check(Math.abs((await re(() => window.__re.store.getState().sketchDraft.plane.offset)) - st.lower) < 1e-9, 'Bottom puts it back on the bottom section')
    check((await chains()).length === 10, 'the cuts are still all ten, now flattened onto the plane where it stands')
  }

  // Hovering a side handle shows a resize cursor.
  const side = await handleAt(1, 0)
  await page.mouse.move(side.x, side.y); await sleep(400)
  const cursor = await page.evaluate(() => getComputedStyle(document.querySelector('.stage canvas') ?? document.body).cursor)
  check(/resize/.test(cursor), `hovering a side handle shows a resize cursor (${cursor})`)

  // The +u side dragged in to u = 4: the box narrows, only the cuts inside stay.
  await drag(side, await planePointAt(4, 0)); await settled()
  s = await stack(); cs = await chains()
  const e1 = extent(cs)
  check(near(s.rect.u1, 4, 0.6) && s.rect.u0 < -10, `dragging the right side handle to u = 4 narrows the box (${JSON.stringify(s.rect)})`)
  check(cs.length > 0 && e1.u1 <= s.rect.u1 + 1e-6 && near(e1.u1, s.rect.u1, 0.05), `the cuts stop at the box's new side (cut points to u = ${e1.u1.toFixed(3)})`)
  await page.screenshot({ path: shotPath('stack-box-2-side-in.png') })

  // The (−u, −v) corner dragged out: both its sides move.
  const corner = await handleAt(-1, -1)
  const before = { ...s.rect }
  await drag(corner, await planePointAt(before.u0 - 6, before.v0 - 4)); await settled()
  s = await stack()
  check(near(s.rect.u0, before.u0 - 6, 0.6) && near(s.rect.v0, before.v0 - 4, 0.6) && near(s.rect.u1, before.u1, 1e-9) && near(s.rect.v1, before.v1, 1e-9), `dragging a corner moves its two sides only (${JSON.stringify(s.rect)})`)
  await page.screenshot({ path: shotPath('stack-box-3-corner-out.png') })

  // A narrow box moved by its centre over the right-hand end.
  const left = await handleAt(-1, 0)
  const panelRight = await page.$eval('.re-place, [data-test=place-planes]', (e) => (e.closest('.re-place') ?? e.closest('[class*=panel]') ?? e).getBoundingClientRect().right).catch(() => 530)
  console.log(`left side handle at x ${left.x.toFixed(0)}, the Create Sketch panel ends at x ${panelRight.toFixed(0)}`)
  await drag(left, await planePointAt(-2, 0)); await settled()
  s = await stack()
  const width = s.rect.u1 - s.rect.u0
  const centre = await handleAt(0, 0)
  await drag(centre, await planePointAt((s.rect.u0 + s.rect.u1) / 2 + 3, (s.rect.v0 + s.rect.v1) / 2)); await settled()
  const moved = await stack(); cs = await chains()
  const e3 = extent(cs)
  check(near(moved.rect.u1 - moved.rect.u0, width, 1e-6) && near(moved.rect.u0, s.rect.u0 + 3, 0.6), `the centre handle moves the whole box, its size kept (${JSON.stringify(moved.rect)})`)
  check(cs.length > 0 && e3.u0 >= moved.rect.u0 - 1e-6 && e3.u1 <= moved.rect.u1 + 1e-6, `the cuts follow the box: u ${e3.u0.toFixed(2)}..${e3.u1.toFixed(2)} inside ${moved.rect.u0.toFixed(2)}..${moved.rect.u1.toFixed(2)}`)
  await page.screenshot({ path: shotPath('stack-box-4-moved.png') })

  // A drag on empty space orbits the view and leaves the box alone.
  const view = await re(() => { const c = window.__re.scene().camera; return c.position.toArray() })
  // Orbit is the middle button, as the status bar says.
  await page.mouse.move(1380, 820); await page.mouse.down({ button: 'middle' })
  for (let i = 1; i <= 10; i++) { await page.mouse.move(1380 - i * 8, 820 - i * 6, { steps: 1 }); await sleep(25) }
  await page.mouse.up({ button: 'middle' }); await sleep(400)
  const after = await stack(), view2 = await re(() => window.__re.scene().camera.position.toArray())
  check(JSON.stringify(after.rect) === JSON.stringify(moved.rect), 'a drag on empty space does not touch the box')
  check(view.some((v, i) => Math.abs(v - view2[i]) > 1e-6), 'and turns the view, as it should')

  // Outline Mesh with the narrow box: the outline is kept inside it too.
  await click(page, '[data-test=place-outline-mode]'); await sleep(400); await settled()
  cs = await chains()
  const e4 = extent(cs)
  check(cs.length > 0 && e4.u0 >= moved.rect.u0 - 1e-6 && e4.u1 <= moved.rect.u1 + 1e-6, `Outline Mesh keeps only the outline inside the box (u ${e4.u0.toFixed(2)}..${e4.u1.toFixed(2)})`)
  await page.screenshot({ path: shotPath('stack-box-5-outline.png') })
  await click(page, '[data-test=place-outline-mode]'); await sleep(400); await settled()

  // Create keeps what the box isolated; Stacked sections off takes the box away.
  await click(page, '[data-test=place-stacked]'); await sleep(500)
  const gone = await re(() => window.__re.reScene().stackHandlePositions().length)
  check(gone === 0 && !(await stack()).on, 'unticking Stacked sections takes the box and its handles away')
} catch (error) { check(false, error.stack ?? error.message) }
await finish(browser, consoleErrors)
