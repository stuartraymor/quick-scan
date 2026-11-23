// SPDX-License-Identifier: AGPL-3.0-only
// Analysis → Measure and the snap bar: while the dialog is open the bar at
// the bottom of the graphics window shows what a click takes on the mesh —
// Surface (where the click lands) and Vertex (the mesh vertex nearest it).
// Points are clicked on a cylinder whose only vertices are on its two rims
// and at the middles of its ends.
import { writeFileSync } from 'node:fs'
import { check, click, finish, launchApp, loadScan, shotPath, sleep } from './e2e-lib.mjs'

const fixture = shotPath('measure-cylinder-r10.obj'), n = 96, obj = []
for (const z of [-5, 5]) for (let i = 0; i < n; i++) obj.push(`v ${10 * Math.cos(i * Math.PI * 2 / n)} ${10 * Math.sin(i * Math.PI * 2 / n)} ${z}`)
obj.push('v 0 0 -5', 'v 0 0 5')
for (let i = 0; i < n; i++) { const a = i + 1, b = (i + 1) % n + 1, c = a + n, d = b + n; obj.push(`f ${a} ${b} ${d}`, `f ${a} ${d} ${c}`, `f ${2 * n + 1} ${b} ${a}`, `f ${2 * n + 2} ${c} ${d}`) }
writeFileSync(fixture, obj.join('\n'))

const { browser, page, consoleErrors } = await launchApp({ width: 1500, height: 960 })
const bar = () => page.evaluate(() => { const el = document.querySelector('[data-test=snap-bar]'); return el ? { context: el.dataset.context, keys: Object.fromEntries([...el.querySelectorAll('button')].map((b) => [b.dataset.test, b.getAttribute('aria-pressed') === 'true'])) } : null })
const isVertex = ([x, y, z]) => Math.abs(Math.abs(z) - 5) < 1e-3 && (Math.abs(Math.hypot(x, y) - 10) < 1e-3 || Math.hypot(x, y) < 1e-3)
const points = () => page.evaluate(() => [...document.querySelectorAll('.measure-label')].map((el) => el.textContent.match(/-?\d+\.\d+/g).map(Number)).filter((p) => p.length === 3))
try {
  await page.evaluate(() => localStorage.removeItem('scanruler.snapfilter'))
  await loadScan(page, fixture)
  await page.evaluate(() => [...document.querySelectorAll('button, [role=tab]')].find((b) => b.textContent.trim() === 'Analysis')?.click())
  await sleep(400)
  check((await bar()) === null, 'no snap bar before a tool that takes points is open')
  await click(page, '[data-test=ribbon-measure]')
  await page.waitForSelector('[data-test=measure-dialog]')
  await click(page, '[data-test=measure-point]'); await sleep(200)
  let b = await bar()
  check(b && b.context === 'measure' && b.keys['snap-curve'] === true && b.keys['snap-endpoint'] === false && Object.keys(b.keys).length === 3 && b.keys["snap-all"] === false, `Measure open: the bar shows Vertex (off) and Surface (on) (${JSON.stringify(b)})`)
  const canvas = await page.$eval('.desktop-mid canvas', (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
  const spots = [[-37, -23], [41, 17], [13, -44], [-19, 38], [57, -9]]
  const pickAll = async () => { await click(page, '[data-test=measure-delete-all]').catch(() => {}); await sleep(150); for (const [dx, dy] of spots) { await page.mouse.move(canvas.x + dx, canvas.y + dy); await sleep(60); await page.mouse.click(canvas.x + dx, canvas.y + dy); await sleep(250) } return points() }
  const free = await pickAll()
  check(free.length === spots.length && free.some((p) => !isVertex(p)), `Surface: ${free.length} clicks land where they are clicked, off the vertices (${free.filter((p) => !isVertex(p)).length} of ${free.length} not on a vertex)`)
  await click(page, '[data-test=snap-endpoint]'); await sleep(200)
  check((await bar()).keys['snap-endpoint'] === true, 'Vertex switched on in the bar')
  const snapped = await pickAll()
  check(snapped.length === spots.length && snapped.every(isVertex), `Vertex: the same ${snapped.length} clicks each take a mesh vertex (${JSON.stringify(snapped.map((p) => p.map((v) => +v.toFixed(3))))})`)
  await page.screenshot({ path: shotPath('01-measure-vertex.png') })
  // All: a click on a vertex takes the vertex, a click elsewhere the surface.
  const where = await page.evaluate(() => { const r = document.querySelector('.measure-label').getBoundingClientRect(); return { x: r.left + r.width / 2 - 60, y: r.top + r.height / 2 } })
  await click(page, '[data-test=snap-all]'); await sleep(200)
  const smartBar = await bar()
  check(Object.keys(smartBar.keys)[0] === 'snap-all' && smartBar.keys['snap-all'], `All is the first switch and is now on (${JSON.stringify(smartBar.keys)})`)
  await click(page, '[data-test=measure-delete-all]'); await sleep(150)
  await page.mouse.click(where.x + 3, where.y + 2); await sleep(250)
  await page.mouse.click(canvas.x - 37, canvas.y - 23); await sleep(250)
  const smart = await points()
  check(smart.length === 2 && isVertex(smart[0]) && !isVertex(smart[1]), `All: a click 4 px off a vertex takes the vertex, a click on open surface stays where it lands (${JSON.stringify(smart.map((q) => q.map((v) => +v.toFixed(3))))})`)
  await click(page, '[data-test=snap-all]'); await sleep(150)
  await click(page, '[data-test=snap-endpoint]'); await sleep(150)
  const again = await pickAll()
  check(again.some((p) => !isVertex(p)), 'Vertex off again: clicks land on the surface again')
  await click(page, '[data-test=measure-close]'); await sleep(300)
  check((await bar()) === null, 'the dialog closed: the bar goes with it')
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('scanruler.snapfilter') ?? 'null'))
  check(kept?.measure?.endpoint === false && kept?.measure?.curve === true, 'the switches are remembered on this computer')
} catch (error) { check(false, error.stack ?? error.message) }
await finish(browser, consoleErrors)
