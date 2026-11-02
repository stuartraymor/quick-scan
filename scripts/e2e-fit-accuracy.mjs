// SPDX-License-Identifier: AGPL-3.0-only
// Independent accuracy check of the plane and cylinder fits. For each example
// mesh in public/reference-examples (third-party, local only) it finds the
// dominant planar faces and circular walls from the triangles alone (normal
// clustering, RANSAC circles, then its own least squares), hands the same
// vertices to the worker's fitSelection, and prints both answers side by side.
// Needs the dev server (window.__scanruler). Usage: node scripts/e2e-fit-accuracy.mjs basic_part,bearinghousing
import fs from 'node:fs'
import { launchApp, OUT_DIR } from './e2e-lib.mjs'
const dir = new URL('../public/reference-examples/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const models = (process.argv[2] ?? 'basic_part,bearinghousing,aerosol_knob').split(',')
const all = {}
for (const f of models) {
  const { browser, page } = await launchApp({ width: 1700, height: 900, url: process.env.APP_URL ?? 'http://localhost:5173/', protocolTimeout: 600000 })
  await new Promise(r => setTimeout(r, 2500))
  const bytes = [...fs.readFileSync(dir + f + '.stl')]
  await page.evaluate((b, n) => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(b)], n)); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })) }, bytes, f + '.stl')
  await page.waitForFunction(() => window.__scanruler?.scene?.().scanPositions?.(), { timeout: 120000 })
  await new Promise(r => setTimeout(r, 6000))
  const r = await page.evaluate(async () => {
    const S = window.__scanruler, scene = S.scene(), P = scene.marking.ctx.mesh().geometry.attributes.position.array, SP = scene.scanPositions()
    const key = (a, i) => a[i * 3] + ',' + a[i * 3 + 1] + ',' + a[i * 3 + 2]
    const toWorker = new Map(); for (let i = 0; i < SP.length / 3; i++) toWorker.set(key(SP, i), i)
    const I = scene.marking.ctx.mesh().geometry.index.array, nT = I.length / 3
    const N = new Float64Array(nT * 3), A = new Float64Array(nT), C = new Float64Array(nT * 3)
    for (let t = 0; t < nT; t++) {
      const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2]
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
      const l = Math.hypot(nx, ny, nz) || 1
      A[t] = l / 2; N[t * 3] = nx / l; N[t * 3 + 1] = ny / l; N[t * 3 + 2] = nz / l
      C[t * 3] = (P[a] + P[b] + P[c]) / 3; C[t * 3 + 1] = (P[a + 1] + P[b + 1] + P[c + 1]) / 3; C[t * 3 + 2] = (P[a + 2] + P[b + 2] + P[c + 2]) / 3
    }
    const dot = (t, n) => N[t * 3] * n[0] + N[t * 3 + 1] * n[1] + N[t * 3 + 2] * n[2]
    const order = [...Array(nT).keys()].sort((a, b) => A[b] - A[a]).slice(0, 600)
    const dirs = []
    for (const t of order) {
      const n = [N[t * 3], N[t * 3 + 1], N[t * 3 + 2]]
      if (dirs.some(d => Math.abs(d.n[0] * n[0] + d.n[1] * n[1] + d.n[2] * n[2]) > Math.cos(3 * Math.PI / 180))) continue
      let w = 0
      for (let u = 0; u < nT; u += 3) if (Math.abs(dot(u, n)) > Math.cos(1.5 * Math.PI / 180)) w += A[u]
      dirs.push({ n, w })
    }
    dirs.sort((a, b) => b.w - a.w)
    const eig = (m) => {
      const a = m.map(r => r.slice()), v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
      for (let it = 0; it < 60; it++) {
        let p = 0, q = 1, mx = 0
        for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) if (Math.abs(a[i][j]) > mx) { mx = Math.abs(a[i][j]); p = i; q = j }
        if (mx < 1e-14) break
        const th = (a[q][q] - a[p][p]) / (2 * a[p][q]); const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)); const c = 1 / Math.sqrt(t * t + 1), s = t * c
        for (let k = 0; k < 3; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y }
        for (let k = 0; k < 3; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y }
        for (let k = 0; k < 3; k++) { const x = v[k][p], y = v[k][q]; v[k][p] = c * x - s * y; v[k][q] = s * x + c * y }
      }
      let best = 0
      for (let i = 1; i < 3; i++) if (a[i][i] < a[best][best]) best = i
      return [v[0][best], v[1][best], v[2][best]]
    }
    const vertsOf = (tris) => { const s = new Set(); for (const t of tris) for (let k = 0; k < 3; k++) { const w = toWorker.get(key(P, I[t * 3 + k])); if (w !== undefined) s.add(w) } return [...s] }
    const settings = S.measure.getState().settings
    const out = { tris: nT, dirs: dirs.slice(0, 4).map(d => ({ n: d.n.map(x => +x.toFixed(4)), area: +d.w.toFixed(0) })), planes: [], cylinders: [] }
    for (const d of dirs.slice(0, 3)) {
      const tris = []
      for (let t = 0; t < nT; t++) if (dot(t, d.n) > Math.cos(1.5 * Math.PI / 180)) tris.push(t)
      const off = tris.map(t => C[t * 3] * d.n[0] + C[t * 3 + 1] * d.n[1] + C[t * 3 + 2] * d.n[2])
      const h = new Map()
      tris.forEach((t, i) => { const k = Math.round(off[i] / 0.1); h.set(k, (h.get(k) ?? 0) + A[t]) })
      let bk = 0, bw = 0
      for (const [k, w] of h) if (w > bw) { bw = w; bk = k }
      const sel = tris.filter((t, i) => Math.abs(off[i] - bk * 0.1) < 0.1)
      const vs = vertsOf(sel)
      if (vs.length < 50) continue
      let mx = 0, my = 0, mz = 0
      for (const v of vs) { mx += SP[v * 3]; my += SP[v * 3 + 1]; mz += SP[v * 3 + 2] }
      mx /= vs.length; my /= vs.length; mz /= vs.length
      const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
      for (const v of vs) { const q = [SP[v * 3] - mx, SP[v * 3 + 1] - my, SP[v * 3 + 2] - mz]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i][j] += q[i] * q[j] }
      let n = eig(m)
      if (n[0] * d.n[0] + n[1] * d.n[1] + n[2] * d.n[2] < 0) n = n.map(x => -x)
      const dd = n[0] * mx + n[1] * my + n[2] * mz
      const t0 = performance.now()
      const fit = await S.client().fitSelection('plane', Uint32Array.from(vs), settings)
      out.planes.push({ verts: vs.length, truth: { n: n.map(x => +x.toFixed(5)), d: +dd.toFixed(4) }, qs: { keys: Object.keys(fit).filter(k => k !== 'region'), fit: JSON.parse(JSON.stringify({ ...fit, region: undefined })) }, ms: Math.round(performance.now() - t0) })
    }
    for (const d of dirs.slice(0, 3)) {
      const a = d.n
      const u = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
      const cr = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]]
      let e1 = cr(a, u); const l = Math.hypot(...e1); e1 = e1.map(x => x / l)
      const e2 = cr(a, e1)
      const side = []
      for (let t = 0; t < nT; t++) if (Math.abs(dot(t, a)) < 0.02) side.push(t)
      if (side.length < 200) continue
      const pt = side.map(t => [C[t * 3] * e1[0] + C[t * 3 + 1] * e1[1] + C[t * 3 + 2] * e1[2], C[t * 3] * e2[0] + C[t * 3 + 1] * e2[1] + C[t * 3 + 2] * e2[2]])
      const found = []
      let remaining = side.map((_, i) => i)
      for (let rep = 0; rep < 3; rep++) {
        let best = null
        for (let it = 0; it < 4000; it++) {
          const i = remaining[Math.random() * remaining.length | 0], j = remaining[Math.random() * remaining.length | 0], k = remaining[Math.random() * remaining.length | 0]
          const [x1, y1] = pt[i], [x2, y2] = pt[j], [x3, y3] = pt[k]
          const D = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2))
          if (Math.abs(D) < 1e-6) continue
          const cx = ((x1 * x1 + y1 * y1) * (y2 - y3) + (x2 * x2 + y2 * y2) * (y3 - y1) + (x3 * x3 + y3 * y3) * (y1 - y2)) / D
          const cy = ((x1 * x1 + y1 * y1) * (x3 - x2) + (x2 * x2 + y2 * y2) * (x1 - x3) + (x3 * x3 + y3 * y3) * (x2 - x1)) / D
          const r = Math.hypot(x1 - cx, y1 - cy)
          if (r < 1.5 || r > 90) continue
          let w = 0
          for (const q of remaining) {
            const rl = Math.hypot(pt[q][0] - cx, pt[q][1] - cy)
            if (Math.abs(rl - r) < 0.03) {
              const t = side[q], nx = N[t * 3] * e1[0] + N[t * 3 + 1] * e1[1] + N[t * 3 + 2] * e1[2], ny = N[t * 3] * e2[0] + N[t * 3 + 1] * e2[1] + N[t * 3 + 2] * e2[2]
              if (Math.abs(nx * (pt[q][0] - cx) / (rl || 1) + ny * (pt[q][1] - cy) / (rl || 1)) > 0.97) w += A[t]
            }
          }
          if (!best || w > best.w) best = { cx, cy, r, w }
        }
        if (!best || best.w < 3) break
        const inl = remaining.filter(q => Math.abs(Math.hypot(pt[q][0] - best.cx, pt[q][1] - best.cy) - best.r) < 0.03)
        const inSet = new Set(inl)
        remaining = remaining.filter(q => !inSet.has(q))
        found.push({ ...best, tris: inl.map(q => side[q]) })
      }
      for (const c of found) {
        const vs = vertsOf(c.tris)
        if (vs.length < 80) continue
        const rows = vs.map(v => [SP[v * 3] * e1[0] + SP[v * 3 + 1] * e1[1] + SP[v * 3 + 2] * e1[2], SP[v * 3] * e2[0] + SP[v * 3 + 1] * e2[1] + SP[v * 3 + 2] * e2[2]])
        let cx = c.cx, cy = c.cy, r = c.r
        const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
        for (let it = 0; it < 20; it++) {
          const H = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], g = [0, 0, 0]
          for (const [x, y] of rows) {
            const dx = x - cx, dy = y - cy, di = Math.hypot(dx, dy) || 1e-9, res = di - r, J = [-dx / di, -dy / di, -1]
            for (let i = 0; i < 3; i++) { g[i] += J[i] * res; for (let j = 0; j < 3; j++) H[i][j] += J[i] * J[j] }
          }
          const D0 = det(H)
          if (Math.abs(D0) < 1e-12) break
          const sol = [0, 1, 2].map(c2 => det(H.map((row, i) => row.map((v, j) => j === c2 ? g[i] : v))) / D0)
          cx -= sol[0]; cy -= sol[1]; r -= sol[2]
        }
        const axial = vs.map(v => SP[v * 3] * a[0] + SP[v * 3 + 1] * a[1] + SP[v * 3 + 2] * a[2])
        const lo = Math.min(...axial), hi = Math.max(...axial)
        const mid = (lo + hi) / 2
        const center = [0, 1, 2].map(i => cx * e1[i] + cy * e2[i] + a[i] * mid)
        const t0 = performance.now()
        const fit = await S.client().fitSelection('cylinder', Uint32Array.from(vs), settings)
        out.cylinders.push({ verts: vs.length, axis: a.map(x => +x.toFixed(4)), truth: { r: +r.toFixed(4), center: center.map(x => +x.toFixed(3)), len: +(hi - lo).toFixed(2) }, qs: { r: fit.radius, center: fit.center, axis: fit.axis, sigma: fit.sigma, length: fit.length }, ms: Math.round(performance.now() - t0) })
      }
    }
    return out
  })
  all[f] = r
  console.log(f, JSON.stringify(r).slice(0, 7000))
  await browser.close()
}
fs.writeFileSync(OUT_DIR + '/fit-accuracy.json', JSON.stringify(all, null, 1))
