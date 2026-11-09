// SPDX-License-Identifier: AGPL-3.0-only
// Fit Surface → Control Net, end to end: the tick in the box, off to begin
// with; ticked, the net is drawn over the part (a pole at every point of the
// 5 × 5 net, the lines joining them); unticked, gone; a plane has no tick.
// The sample bracket is built in the page and loaded through the Scan slot.
//
//   npm run dev &  node plugins/reverse/scripts/e2e-reverse-control-net.mjs
import { check, click, finish, launchApp, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'

const DEPTH = 20
// The sample's pose, as src/core/geometry/samplePart.ts has it, and its inverse: the part is aligned back to the frame it was made in.
function samplePose() {
  const [x, y, z] = [0.36, 0.48, 0.8]
  const a = (14 * Math.PI) / 180
  const c = Math.cos(a), s = Math.sin(a), t = 1 - c
  return { r: [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c], t: [18, -7, 25] }
}
function invert(m) {
  const r = [m.r[0], m.r[3], m.r[6], m.r[1], m.r[4], m.r[7], m.r[2], m.r[5], m.r[8]]
  return { r, t: [0, 1, 2].map((i) => -(r[i * 3] * m.t[0] + r[i * 3 + 1] * m.t[1] + r[i * 3 + 2] * m.t[2])) }
}

const { browser, page, consoleErrors } = await launchApp({ width: 1600, height: 1000, protocolTimeout: 600_000 })
await page.click('[data-test=workspace-reverse]')
await page.waitForSelector('[data-test=kernel-status]')
await page.waitForFunction(() => /ready/.test(document.querySelector('[data-test=kernel-status]')?.textContent ?? ''), { timeout: 180_000 }).catch(() => {})
check(/ready/.test(await page.$eval('[data-test=kernel-status]', (el) => el.textContent)), 'the CAD kernel loads')

await page.evaluate(async () => {
  const { buildSamplePart } = await import('/src/core/geometry/samplePart.ts')
  const { buildBinaryStl } = await import('/src/core/exportStl.ts')
  const part = buildSamplePart()
  const file = new File([buildBinaryStl(part.positions, part.indices, null, 'ScanRuler sample bracket')], 'sample-bracket.stl')
  const input = document.querySelector('[data-test=slot-scan] input[type=file]')
  const dt = new DataTransfer()
  dt.items.add(file)
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
})
await page.waitForFunction(() => /[1-9][\d,]* triangles/.test(document.querySelector('.file-info')?.textContent ?? ''), { timeout: 120_000 })
await sleep(500)
await page.evaluate(() => document.querySelector('[data-test=support-card] button')?.click())
await page.evaluate((m) => window.__re.alignTo(m), invert(samplePose()))
await sleep(800)

// The net drawn over the part: the lines (instanced segments) and the points the scene holds.
const netInScene = () =>
  page.evaluate(() => {
    const out = { segments: 0, points: 0 }
    window.__re.scene().partGroup.traverse((o) => {
      if (o.isLineSegments2 && o.material?.depthTest === false && o.material.color.getHex() === 0xdfe6ee) out.segments += o.geometry.attributes.instanceStart.count
      if (o.isPoints && o.material?.color?.getHex() === 0x3b82f6) out.points += o.geometry.attributes.position.count
    })
    return out
  })

// A Fit surface through the L's end face (z = DEPTH), by coordinate.
await page.evaluate((depth) => {
  const p = window.__re.scene().scanPositions()
  const region = []
  for (let v = 0; v < p.length / 3; v++) if (Math.abs(p[v * 3 + 2] - depth) < 1e-3) region.push(v)
  const re = window.__re.store.getState()
  re.startFeature('surface')
  const now = window.__re.store.getState()
  now.setFeatureDraft({ shape: 'freeform', fit: { ...now.featureDraft.fit, net: { u: 5, v: 5 } } })
  now.setRegion(Uint32Array.from(region))
  return region.length
}, DEPTH)
await page.waitForSelector('[data-test=surface-editor]')
await page.waitForFunction(() => /Fitted/.test(document.querySelector('[data-test=surface-preview]')?.textContent ?? ''), { timeout: 90_000 }).catch(() => {})
console.log('fit:', await page.$eval('[data-test=surface-preview]', (el) => el.textContent).catch(() => '(none)'))

check((await page.$eval('[data-test=surface-control-net]', (el) => el.checked).catch(() => null)) === false, 'a freeform fit has a Control Net tick, off to begin with')
let net = await netInScene()
check(net.segments === 0 && net.points === 0, 'and draws no net')
await click(page, '[data-test=surface-control-net]')
await page.waitForFunction(() => window.__re.scene().partGroup.children.length > 0, { timeout: 5_000 }).catch(() => {})
await sleep(600)
net = await netInScene()
console.log('net in scene:', JSON.stringify(net))
check(net.points === 25, `ticked, a point stands on each of the 25 poles (${net.points})`)
check(net.segments === 2 * 5 * 4, `and the lines join them, 4 along each of 5 rows and 5 columns (${net.segments} segments)`)
await page.screenshot({ path: shotPath('control-net-on.png') })

// A different net, drawn at once: the net follows the numbers.
await page.evaluate(() => {
  const re = window.__re.store.getState()
  re.setFeatureDraft({ fit: { ...re.featureDraft.fit, net: { u: 4, v: 6 } } })
})
await page.waitForFunction(() => /4 × 6|4×6|U 4/.test(document.querySelector('[data-test=surface-preview]')?.textContent ?? '') || true, { timeout: 2_000 }).catch(() => {})
await sleep(2500)
net = await netInScene()
console.log('net in scene after 4 × 6:', JSON.stringify(net))
check(net.points === 24, `typing another net redraws it: 4 × 6 poles (${net.points})`)

await click(page, '[data-test=surface-control-net]')
await sleep(400)
net = await netInScene()
check(net.segments === 0 && net.points === 0, 'unticked, the net is gone')

// Ticked again, then a plane: no net to show, and the tick goes with the shape.
await click(page, '[data-test=surface-control-net]')
await page.select('[data-test=surface-shape]', 'plane')
await sleep(1500)
check((await page.$('[data-test=surface-control-net]')) === null, 'a plane has no Control Net tick')
net = await netInScene()
check(net.segments === 0 && net.points === 0, 'and no net is drawn for it')
await page.select('[data-test=surface-shape]', 'freeform')
await sleep(1500)
// Commit the fitted sheet: it must be exportable from the same panel as a solid.
await page.waitForFunction(() => !document.querySelector('[data-test=surface-create]')?.disabled, { timeout: 60_000 })
await click(page, '[data-test=surface-create]')
await page.waitForFunction(() => !document.querySelector('[data-test=surface-editor]'), { timeout: 60_000 })
await page.waitForFunction(() => !document.querySelector('[data-test=export-body-step]')?.disabled, { timeout: 60_000 })
check(await page.$eval('[data-test=export-body-step]', e => !e.disabled), 'a committed fitted sheet enables STEP export')
await page.evaluate(() => {
  const original = URL.createObjectURL.bind(URL)
  URL.createObjectURL = blob => {
    if (blob instanceof Blob) blob.text().then(text => { if (text.startsWith('ISO-10303-21;')) window.__exportedSurfaceStep = text })
    return original(blob)
  }
})
await click(page, '[data-test=export-body-step]')
await page.waitForFunction(() => !!window.__exportedSurfaceStep, { timeout: 60_000 })
check(await page.evaluate(() => window.__exportedSurfaceStep.includes('B_SPLINE_SURFACE_WITH_KNOTS')), 'the panel exports the fitted sheet as a B-spline STEP surface')
await page.evaluate(() => { window.__exportedSurfaceStep = null })
await page.waitForFunction(() => { const button = document.querySelector('[data-test=ribbon-export]'); return button && !button.disabled }, { timeout: 30_000 })
await click(page, '[data-test=ribbon-export]')
await page.waitForFunction(() => !!window.__exportedSurfaceStep, { timeout: 60_000 })
check(await page.evaluate(() => window.__exportedSurfaceStep.includes('B_SPLINE_SURFACE_WITH_KNOTS')), 'the CAD ribbon also exports the fitted sheet')
await sleep(500)
net = await netInScene()
check(net.segments === 0 && net.points === 0, 'closing the box takes the net off the part')

await finish(browser, consoleErrors)
