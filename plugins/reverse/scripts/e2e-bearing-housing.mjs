// SPDX-License-Identifier: AGPL-3.0-only
// Reconstruction acceptance on QUICKSURFACE's Bearing housing example mesh
// (bearinghousing.stl, 164,425 triangles; third-party, kept in
// public/reference-examples and out of Git). The main body is a drum about an
// axis within 3 degrees of Y. The script squares the part to that axis, slices
// it, fits and closes the section, extrudes between the end planes, exports the
// body as STEP, reads it back through meshStep and reports: closed solid or
// not, bounding box, volume against the mesh, and the median and 95th
// percentile scan-to-body distance. The bolt bosses and holes are NOT modelled
// here, so the volume and the far percentiles say how much of the part is
// left; they are not a pass bar. The checks are: kernel ready, section found,
// a body, closed solid, length along the drum axis within 1 mm.
//   node plugins/reverse/scripts/e2e-bearing-housing.mjs
// Env: CHROME, APP_URL, SCAN (STL path), SHOT_DIR.
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importStep } from 'meshstep'
import { check, click, downloadsTo, fail, finish, launchApp, loadScan, pickOption, repoFile, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'

const SCAN = process.env.SCAN ?? repoFile('public/reference-examples/bearinghousing.stl')
const AXIS = [-0.0014, 0.999, 0.0456]
const dir = mkdtempSync(join(tmpdir(), 'scanruler-bearing-'))
const { browser, page, consoleErrors } = await launchApp({ width: 1600, height: 1000, protocolTimeout: 600_000 })
await downloadsTo(page, dir)
await loadScan(page, SCAN, { timeout: 300_000 })
// Binary STL read here: positions per triangle corner, unwelded, which volume and
// distance need no more than.
const raw = readFileSync(SCAN)
const triCount = raw.readUInt32LE(80)
const P = new Float32Array(triCount * 9)
for (let q = 0; q < triCount; q++) for (let k = 0; k < 9; k++) P[q * 9 + k] = raw.readFloatLE(84 + q * 50 + 12 + k * 4)
const stl = { positions: P, indices: Uint32Array.from({ length: triCount * 3 }, (_, i) => i) }
// Frame: Z along the drum axis, X as close to world X as it can be, Y right-handed.
const az = normalize3(AXIS)
const ax = normalize3(sub3([1, 0, 0], scale3(az, dot3([1, 0, 0], az))))
const ay = cross3(az, ax)
const r = [...ax, ...ay, ...az]
const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]
for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P[i + k]); mx[k] = Math.max(mx[k], P[i + k]) }
const c = [0, 1, 2].map((k) => (mn[k] + mx[k]) / 2)
const t = [-(r[0] * c[0] + r[1] * c[1] + r[2] * c[2]), -(r[3] * c[0] + r[4] * c[1] + r[5] * c[2]), -(r[6] * c[0] + r[7] * c[1] + r[8] * c[2])]
const aligned = new Float32Array(P.length)
for (let i = 0; i < P.length; i += 3) {
  const x = P[i], y = P[i + 1], z = P[i + 2]
  aligned[i] = r[0] * x + r[1] * y + r[2] * z + t[0]
  aligned[i + 1] = r[3] * x + r[4] * y + r[5] * z + t[1]
  aligned[i + 2] = r[6] * x + r[7] * y + r[8] * z + t[2]
}
const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
for (let i = 0; i < aligned.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], aligned[i + k]); hi[k] = Math.max(hi[k], aligned[i + k]) }
console.log('aligned bounds:', lo.map((v) => v.toFixed(2)), hi.map((v) => v.toFixed(2)))
const meshVolume = (pos, idx) => {
  let v = 0
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, cc = idx[i + 2] * 3
    v += (pos[a] * (pos[b + 1] * pos[cc + 2] - pos[b + 2] * pos[cc + 1]) - pos[a + 1] * (pos[b] * pos[cc + 2] - pos[b + 2] * pos[cc]) + pos[a + 2] * (pos[b] * pos[cc + 1] - pos[b + 1] * pos[cc])) / 6
  }
  return v
}

await page.click('[data-test=workspace-reverse]')
await page.waitForFunction(() => /ready/.test(document.querySelector('[data-test=kernel-status]')?.textContent ?? ''), { timeout: 180_000 }).catch(() => {})
check(/ready/.test(await page.$eval('[data-test=kernel-status]', (el) => el.textContent)), 'the CAD kernel is ready')
await page.evaluate((m) => window.__re.alignTo(m), { r, t })
await page.waitForFunction(() => window.__re.store && !document.querySelector('.busy'), { timeout: 60_000 }).catch(() => {})
await sleep(800)

await pickOption(page, '[data-test=sketch-plane-select]', 'XY plane')
await page.waitForSelector('[data-test=sketch-editor]')
await page.waitForFunction(() => /slice chain/.test(document.querySelector('[data-test=sketch-plane]')?.textContent ?? ''), { timeout: 60_000 })
console.log('plane:', await page.$eval('[data-test=sketch-plane]', (el) => el.textContent))
const counts = () => page.$eval('[data-test=sketch-counts]', (el) => el.textContent)
await click(page, '[data-test=sketch-fit-all]'); await sleep(1500); console.log('fitted:', await counts())
await click(page, '[data-test=sketch-infer]'); await sleep(800); console.log('corners:', await counts())
await click(page, '[data-test=sketch-close]'); await sleep(800); console.log('closed:', await counts())
const regionCount = Number((/(\d+) regions?/.exec(await counts()) ?? [])[1])
check(regionCount >= 1, `the closed slice yields at least one region (${regionCount})`)
await page.screenshot({ path: shotPath('bearing-sketch.png') })
// Every closed region of the section is part of the part's outline here, so
// all of them are picked; a bore would be a hole, not a region.
const outer = await page.evaluate(() => (window.__re.store.getState().sketchDraft?.found ?? []).map((f) => f.key))
await click(page, '[data-test=sketch-finish]'); await sleep(300)

const bodyRows = () => page.$$eval('[data-test=body-row]', (els) => els.map((e) => e.querySelector('b').textContent.trim()))
if (regionCount >= 1) {
  await click(page, '[data-test=feature-extrude]')
  await page.waitForSelector('[data-test=extrude-editor]')
  await page.evaluate((keys) => window.__re.store.getState().setExtrude({ regions: keys }), outer)
  await sleep(300)
  console.log('profiles:', await page.$eval('[data-test=extrude-profiles]', (el) => el.textContent))
  const typeInto = async (sel, value) => {
    await page.focus(sel); await page.$eval(sel, (el) => (el.value = '')); await page.type(sel, String(Math.round(value * 1000) / 1000)); await page.keyboard.press('Enter'); await sleep(150)
  }
  await typeInto('[data-test=extrude-from]', lo[2])
  await typeInto('[data-test=extrude-to]', hi[2])
  await click(page, '[data-test=extrude-create]')
  await page.waitForSelector('[data-test=body-row]', { timeout: 120_000 }).catch(() => {})
  console.log('bodies:', JSON.stringify(await bodyRows()))
  await page.screenshot({ path: shotPath('bearing-body.png') })
}
// The three regions are separate islands in the section, so they extrude to
// separate bodies; the bar is that something solid came out.
console.log('body count:', (await bodyRows()).length)
check((await bodyRows()).length >= 1, 'the section extrudes to a body')

const exportKey = await page.$('[data-test=export-body-step]:not([disabled])')
if (exportKey) await exportKey.click(); else fail('Export body STEP is not enabled')
let stepFile = null
for (let i = 0; i < (exportKey ? 150 : 1) && !stepFile; i++) { await sleep(200); stepFile = readdirSync(dir).find((f) => f.endsWith('.step')) }
check(Boolean(stepFile), `a STEP file downloaded (${stepFile ?? 'missing'})`)
const report = { scan: SCAN, aligned: { lo, hi } }
if (stepFile) {
  const text = readFileSync(join(dir, stepFile), 'utf8')
  const back = importStep(text, { surfaceDeviation: 0.01, maxEdge: 3 })
  const d = back.diagnostics
  check(d.openEdges === 0 && d.nonManifoldEdges === 0 && d.facesDropped === 0, 'the export is a closed solid')
  const bp = back.mesh.positions
  const bmn = [Infinity, Infinity, Infinity], bmx = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < bp.length; i += 3) for (let k = 0; k < 3; k++) { bmn[k] = Math.min(bmn[k], bp[i + k]); bmx[k] = Math.max(bmx[k], bp[i + k]) }
  const size = bmx.map((v, k) => v - bmn[k]), scanSize = hi.map((v, k) => v - lo[k])
  console.log('body size', size.map((v) => v.toFixed(2)), 'scan size', scanSize.map((v) => v.toFixed(2)))
  check(Math.abs(size[2] - scanSize[2]) < 1, `the body's length along the drum axis is the scan's within 1 mm (${size[2].toFixed(2)} vs ${scanSize[2].toFixed(2)})`)
  const vol = meshVolume(bp, back.mesh.indices), scanVol = meshVolume(aligned, stl.indices)
  console.log(`volume: body ${vol.toFixed(0)} mm3, scan ${scanVol.toFixed(0)} mm3 (${((100 * vol) / scanVol).toFixed(1)}%)`)
  const dist = distances(aligned, back.mesh, 3000)
  console.log(`scan-to-body distance: median ${dist[dist.length >> 1].toFixed(3)} mm, p95 ${dist[Math.floor(dist.length * 0.95)].toFixed(3)} mm`)
  Object.assign(report, { meshStep: { ok: d.ok, openEdges: d.openEdges, nonManifold: d.nonManifoldEdges, dropped: d.facesDropped, tris: back.mesh.indices.length / 3 }, bodySize: size, scanSize, bodyVolume: vol, scanVolume: scanVol, medianMm: dist[dist.length >> 1], p95Mm: dist[Math.floor(dist.length * 0.95)] })
}
writeFileSync(shotPath('bearing-housing-report.json'), JSON.stringify(report, null, 1))
await finish(browser, consoleErrors)

function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
function scale3(a, s) { return [a[0] * s, a[1] * s, a[2] * s] }
function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
function normalize3(a) { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l] }

/** Sorted distances from a sample of `count` scan vertices to the nearest
 *  triangle of the mesh, brute force. */
function distances(positions, mesh, count) {
  const n = positions.length / 3
  const step = Math.max(1, Math.floor(n / count))
  const tris = mesh.indices.length / 3
  const Pm = mesh.positions, I = mesh.indices
  const out = []
  for (let v = 0; v < n; v += step) {
    const px = positions[v * 3], py = positions[v * 3 + 1], pz = positions[v * 3 + 2]
    let best = Infinity
    for (let q = 0; q < tris; q++) {
      const a = I[q * 3] * 3, b = I[q * 3 + 1] * 3, cc = I[q * 3 + 2] * 3
      const dd = pointTriangleDistanceSq(px, py, pz, Pm[a], Pm[a + 1], Pm[a + 2], Pm[b], Pm[b + 1], Pm[b + 2], Pm[cc], Pm[cc + 1], Pm[cc + 2])
      if (dd < best) best = dd
    }
    out.push(Math.sqrt(best))
  }
  out.sort((x, y) => x - y)
  return out
}

/** Squared distance from a point to a triangle (Ericson, Real-Time Collision
 *  Detection, closest point on triangle via barycentric regions). */
function pointTriangleDistanceSq(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az
  const acx = cx - ax, acy = cy - ay, acz = cz - az
  const apx = px - ax, apy = py - ay, apz = pz - az
  const d1 = abx * apx + aby * apy + abz * apz
  const d2 = acx * apx + acy * apy + acz * apz
  const sq = (x, y, z) => x * x + y * y + z * z
  if (d1 <= 0 && d2 <= 0) return sq(apx, apy, apz)
  const bpx = px - bx, bpy = py - by, bpz = pz - bz
  const d3 = abx * bpx + aby * bpy + abz * bpz
  const d4 = acx * bpx + acy * bpy + acz * bpz
  if (d3 >= 0 && d4 <= d3) return sq(bpx, bpy, bpz)
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return sq(apx - v * abx, apy - v * aby, apz - v * abz) }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz
  const d5 = abx * cpx + aby * cpy + abz * cpz
  const d6 = acx * cpx + acy * cpy + acz * cpz
  if (d6 >= 0 && d5 <= d6) return sq(cpx, cpy, cpz)
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return sq(apx - w * acx, apy - w * acy, apz - w * acz) }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); return sq(px - (bx + w * (cx - bx)), py - (by + w * (cy - by)), pz - (bz + w * (cz - bz))) }
  const denom = 1 / (va + vb + vc)
  const v = vb * denom, w = vc * denom
  return sq(apx - (v * abx + w * acx), apy - (v * aby + w * acy), apz - (v * abz + w * acz))
}
