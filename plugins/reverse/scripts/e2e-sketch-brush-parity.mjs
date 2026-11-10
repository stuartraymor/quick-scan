// SPDX-License-Identifier: AGPL-3.0-only
// Actual pointer brush over an imported synthetic mesh's real section points.
import { writeFileSync } from 'node:fs'
import { check, click, finish, launchApp, loadScan, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { openReverse, reverseHelpers } from './lib.mjs'

const mesh = []
let vertices = 0
function wall(loop) {
  const first = vertices + 1, n = loop.length
  for (const z of [-4, 4]) for (const [x, y] of loop) { mesh.push(`v ${x} ${y} ${z}`); vertices++ }
  for (let i = 0; i < n; i++) { const a = first + i, b = first + (i + 1) % n, c = a + n, d = b + n; mesh.push(`f ${a} ${b} ${d}`, `f ${a} ${d} ${c}`) }
}
const corners = [[-10, -8], [10, -8], [10, 8], [-10, 8]]
wall(corners.flatMap((a, j) => Array.from({ length: 80 }, (_, i) => { const b = corners[(j + 1) % 4], u = i / 80; return [a[0] * (1 - u) + b[0] * u, a[1] * (1 - u) + b[1] * u] })))
wall(Array.from({ length: 160 }, (_, i) => [30 + 8 * Math.cos(i * Math.PI / 80), 8 * Math.sin(i * Math.PI / 80)]))
const meshPath = shotPath('brush-rect-circle-fixture.obj')
writeFileSync(meshPath, mesh.join('\n'))

const { browser, page, consoleErrors } = await launchApp({ width: 1500, height: 960, protocolTimeout: 600_000 })
const { re } = reverseHelpers(page)
try {
  await loadScan(page, meshPath)
  await openReverse(page)
  if (await page.$('[data-test=support-card] .sc-x')) await click(page, '[data-test=support-card] .sc-x')
  await re(async () => {
    const shell = await import('/src/state/shellStore.ts')
    shell.useShell.getState().setInspectorMode('docked')
    window.__brush = (await import('/plugins/reverse/state/sketchBrushStore.ts')).useSketchBrush
    window.__re.store.getState().startSketch({ kind: 'world', axis: 'z', offset: 0 }, { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] })
  })
  await page.waitForSelector('[data-test=sketch-extract]')
  await sleep(1200)
  await click(page, '[data-test=sketch-extract]')
  await page.waitForSelector('[data-test=sketch-fit-brush-overlay]')
  await sleep(300)
  console.log('inspector style:', await re(() => {
    const panel = document.querySelector('[data-test=sketch-extract-panel]'), inspector = panel.closest('.tool-inspector'), style = getComputedStyle(inspector)
    return { theme: document.documentElement.dataset.theme, className: inspector.className, background: style.backgroundColor, panel: style.getPropertyValue('--panel'), hasSupport: CSS.supports('selector(:has(*))'), matchesLight: inspector.matches(':root[data-theme] .tool-inspector:has(.sketch-extract-panel)'), rules: [...document.styleSheets].flatMap((ss) => [...ss.cssRules]).filter((r) => r.selectorText && r.style?.getPropertyValue('--panel') && inspector.matches(r.selectorText)).map((r) => ({ selector: r.selectorText, panel: r.style.getPropertyValue('--panel') })), ancestors: [panel.parentElement.className, panel.parentElement.parentElement.className], styles: [...document.querySelectorAll('style[data-vite-dev-id]')].map((s) => s.dataset.viteDevId).filter((s) => /command-widgets|tool-inspector|reverse\.css/.test(s)) }
  }))
  check(await re(() => {
    const panel = document.querySelector('[data-test=sketch-extract-panel]').closest('.tool-inspector')
    return getComputedStyle(panel).colorScheme === document.documentElement.dataset.theme
  }), 'fitting inspector follows the application theme')
  check(await re(() => window.__re.store.getState().chainCount >= 2), 'real imported mesh produces rectangular and circular section chains')
  const toClient = (p) => re((p) => window.__re.sheet().sheetScreenPoint(p), p)
  const count = () => re(() => window.__brush.getState().selected.length)
  const entities = () => re(() => window.__re.store.getState().sketchDraft.sketch.entities.length)
  const colors = () => re(() => {
    const canvas = document.querySelector('[data-test=sketch-fit-brush-overlay]'), pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let orange = 0, black = 0, green = 0
    for (let i = 0; i < pixels.length; i += 4) { if (pixels[i] === 0 && pixels[i+1] === 0 && pixels[i+2] === 0 && pixels[i+3] > 200) black++; if (pixels[i] > 220 && pixels[i + 1] > 100 && pixels[i + 1] < 190 && pixels[i + 2] < 30 && pixels[i + 3] > 100) orange++; if (pixels[i] < 30 && pixels[i + 1] > 110 && pixels[i + 2] > 25 && pixels[i + 2] < 100 && pixels[i + 3] > 100) green++ }
    return { orange, green, black }
  })
  async function stroke(points, { alt = false, shift = false, beforeUp } = {}) {
    if (alt) await page.keyboard.down('Alt')
    if (shift) await page.keyboard.down('Shift')
    const first = await toClient(points[0])
    await page.mouse.move(first.x, first.y)
    await page.mouse.down()
    for (const p of points.slice(1)) { const at = await toClient(p); await page.mouse.move(at.x, at.y); }
    await sleep(150)
    if (beforeUp) await beforeUp()
    await page.mouse.up()
    if (alt) await page.keyboard.up('Alt')
    if (shift) await page.keyboard.up('Shift')
    await sleep(300)
  }
  const line = (y) => Array.from({ length: 25 }, (_, i) => [-7 + 14 * i / 24, y])
  await click(page, '[data-test=sketch-fit-instant]')
  // Put the centre just inside one radius of a straight edge. Enumerate
  // ground truth in client pixels independently of the brush's grid.
  const near = await toClient([0,-8])
  const target = {x:Math.round(near.x), y:Math.round(near.y)+24}
  await page.mouse.click(target.x,target.y)
  const rim = await re(({x,y}) => {
    const sheet=window.__re.sheet(), state=window.__brush.getState(), expected=[]
    window.__re.chains().chains.forEach((chain,c)=>chain.forEach((p,i)=>{
      const at=sheet.sheetScreenPoint(p)
      if (Math.hypot(at.x-x,at.y-y)<=state.brushPx/2) expected.push(c+':'+i)
    }))
    return {want:expected.sort(),got:state.selected.map(p=>p.key).sort()}
  },target)
  check(rim.want.length>0 && JSON.stringify(rim.got)===JSON.stringify(rim.want), 'circle rim: every visible point inside is selected, none outside ('+rim.want.length+' points)')
  await click(page,'[data-test=sketch-fit-clear]')
  // A high-rate device can submit two sides of a corner in one move. The
  // straight chord misses the intervening corner even though the brush saw it.
  const way = await Promise.all([[4,-8],[10,-8],[10,-2]].map(toClient))
  await page.mouse.move(way[0].x,way[0].y); await page.mouse.down()
  await re(([start,corner,end])=>{
    const host=document.querySelector('[data-test=sketch-viewport]')
    const ev=new PointerEvent('pointermove',{bubbles:true,buttons:1,clientX:end.x,clientY:end.y})
    Object.defineProperty(ev,'getCoalescedEvents',{value:()=>[new PointerEvent('pointermove',{clientX:corner.x,clientY:corner.y})]})
    host.dispatchEvent(ev)
  },way)
  check(await re(()=>window.__brush.getState().selected.some(q=>Math.hypot(q.p[0]-10,q.p[1]+8)<0.01)), 'fast bent stroke includes points at the intermediate corner')
  await page.mouse.up(); await click(page,'[data-test=sketch-fit-clear]')
  await stroke(line(-8), { beforeUp: async () => {
    const held = await colors()
    check(held.orange > 30 && held.black === 0 && held.green === 0, `held stroke draws orange selection without an early fitted line (${JSON.stringify(held)})`)
    await page.screenshot({ path: shotPath('brush-highlight-line-held-1500.png') })
  } })
  const selected = await count(), paint = await colors()
  check(selected > 20, `left brush selects actual section points (${selected})`)
  // On a straight sample chain the released black line covers the orange
  // samples; measure their highlight before release, not through that line.
  check(paint.black > 30 && paint.green === 0, `release draws the solid black fitted line (${JSON.stringify(paint)})`)
  check(await entities() === 0, 'noninstant painting previews geometry without committing')
  await page.screenshot({ path: shotPath('brush-highlight-line-1500.png') })
  const beforeSize = await re(() => window.__brush.getState().brushPx)
  await page.keyboard.down('Control'); await page.mouse.wheel({ deltaY: -120 }); await page.keyboard.up('Control'); await sleep(150)
  check(await re(() => window.__brush.getState().brushPx) > beforeSize, 'Ctrl+wheel increases the actual circular brush diameter')
  await stroke(line(-8), { alt: true })
  check(await count() === 0, 'Alt+paint erases the highlighted section points')
  await stroke(line(-8))
  await click(page, '[data-test=sketch-fit-apply]')
  check(await entities() === 1 && await re(() => window.__re.store.getState().sketchDraft.sketch.entities[0].points.length > 20), 'Apply commits a real measured line with its highlighted soft-data points')
  await re(() => window.__re.store.getState().undoSketch())
  check(await entities() === 0, 'one sketch undo removes the whole fit')
  await re(() => window.__re.store.getState().redoSketch())
  check(await entities() === 1, 'redo restores the fitted primitive')
  await click(page, '[data-test=sketch-fit-instant]')
  await stroke(line(8), { shift: true })
  check(await entities() === 1 && await count() > 20, 'Shift temporarily suppresses instant commit and keeps highlighted points')
  await click(page, '[data-test=sketch-fit-apply]')
  check(await entities() === 2, 'the temporarily held fit remains available for explicit Apply')
  await click(page, '[data-test=sketch-fit-circle]')
  const circle = Array.from({ length: 65 }, (_, i) => { const a = Math.PI * i / 64; return [30 + 8 * Math.cos(a), 8 * Math.sin(a)] })
  await stroke(circle, { beforeUp: async () => {
    check(await re(() => window.__brush.getState().preview?.ok === true), 'circular section brush produces a valid circle before release')
    await page.screenshot({ path: shotPath('brush-highlight-circle-1500.png') })
  } })
  const fittedCircle = await re(() => window.__re.store.getState().sketchDraft.sketch.entities.find((e) => e.kind === 'circle'))
  check(fittedCircle && Math.abs(fittedCircle.r - 8) < 0.1 && Math.hypot(fittedCircle.c[0] - 30, fittedCircle.c[1]) < 0.1, `instant release commits the circle measured from section points (${JSON.stringify(fittedCircle && { r: fittedCircle.r, c: fittedCircle.c })})`)
  await page.setViewport({ width: 1000, height: 720 }); await sleep(500)
  await page.screenshot({ path: shotPath('brush-panel-1000.png') })
  check(await page.$eval('[data-test=sketch-fit-back]', (b) => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight }), 'Back remains visible at 1000×720')
  await click(page, '[data-test=sketch-fit-back]')
  check(await page.$('[data-test=sketch-fit-brush-overlay]') === null, 'Back removes brush input and its overlay')
  check(await re(() => {
    const row = document.querySelector('.sketch-command-row.create'), panel = row.closest('.tool-inspector').getBoundingClientRect(), buttons = [...row.querySelectorAll(':scope > button')]
    return buttons.length === 11 && buttons.every((b) => { const r = b.getBoundingClientRect(); return r.left >= panel.left && r.right <= panel.right })
  }), 'all 11 Create icons fit inside the inspector at 1000×720')
  await page.screenshot({ path: shotPath('sketch-layout-1000.png') })
} catch (error) {
  check(false, error.stack ?? error.message)
}
await finish(browser, consoleErrors)
