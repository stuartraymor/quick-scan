// SPDX-License-Identifier: AGPL-3.0-only
// 2D Sketch overhaul Batch 4: the sketch's tools driven by an agent through
// a real MCP client paired with the app — mirror, pattern, spline refine,
// select and analyse — on a scanned cylinder (R10). Checked from both
// sides: what the tools answer, and what the person sees — the undo key
// naming the agent's step, the pieces the agent picked selected in the
// open sketch editor with the status bar saying the assistant picked them,
// and history_undo taking the agent's step back.
//   node plugins/reverse/scripts/e2e-agent-sketch.mjs
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { check, fail, finish, launchAgent, launchApp, loadScan, repoFile, shotPath, sleep } from '../../../scripts/e2e-lib.mjs'
import { openReverse } from './lib.mjs'
if (!existsSync(repoFile('mcp/node_modules/@modelcontextprotocol/sdk/package.json'))) {
  console.error('FATAL: the MCP server has no dependencies yet — run npm --prefix mcp ci.')
  process.exit(1)
}
const { startAgent } = await import('../../../mcp/tests/client.js')
const out = shotPath('agent-sketch'); mkdirSync(out, { recursive: true })
const mesh = []
for (const z of [-5, 5]) for (let i = 0; i < 160; i++) { const a = (i * Math.PI) / 80; mesh.push(`v ${10 * Math.cos(a)} ${10 * Math.sin(a)} ${z}`) }
mesh.push('v 0 0 -5', 'v 0 0 5')
for (let i = 0; i < 160; i++) { const a = i + 1, b = (i + 1) % 160 + 1; mesh.push(`f ${a} ${b} ${b + 160}`, `f ${a} ${b + 160} ${a + 160}`, `f 321 ${b} ${a}`, `f 322 ${a + 160} ${b + 160}`) }
const meshPath = out + '/cylinder.obj'; writeFileSync(meshPath, mesh.join('\n'))

const { agent } = await launchAgent(startAgent)
const { call } = agent
const ok = async (name, input) => { const r = await call(name, input); if (r.error) fail(`${name}: ${r.text}`); return r }
const link = /(\S+#agent=\d+:[\w-]+)/.exec((await call('scanruler_status')).json?.howToConnect ?? '')?.[1]
check(Boolean(link), 'the server hands out a pairing link')
const { browser, page, consoleErrors } = await launchApp({ url: link, protocolTimeout: 300_000 })
try {
  const waited = await call('scanruler_wait', { for: 'page', timeoutSeconds: 60 })
  check(waited.json?.connected === true, 'the page connected')
  await loadScan(page, meshPath); await openReverse(page)
  const names = (await agent.client.listTools()).tools.map((t) => t.name)
  const wanted = ['reverse_sketch_mirror', 'reverse_sketch_pattern', 'reverse_sketch_spline', 'reverse_sketch_select', 'reverse_sketch_analyse']
  check(wanted.every((n) => names.includes(n)), `the five sketch tools are listed (${wanted.filter((n) => names.includes(n)).length} of 5)`)

  // A sketch across the cylinder at z = 0: the outline circle, a line that
  // leaves the wall, a seed point, a spline, and an arc to pattern along.
  await ok('reverse_feature_add', { feature: { kind: 'sketch', name: 'Plate', plane: { kind: 'world', axis: 'z' }, sketch: { entities: [
    { id: 1, kind: 'circle', c: [0, 0], r: 10 },
    { id: 2, kind: 'line', a: [10, 0], b: [10.4, 6] },
    { id: 3, kind: 'point', p: [14, 0] },
    { id: 4, kind: 'spline', pts: [[-30, 0], [-25, 6], [-20, -3], [-15, 4]], construction: true },
    { id: 5, kind: 'arc', c: [0, -30], r: 8, start: 0, sweep: Math.PI, construction: true },
  ] } } })

  const m = await ok('reverse_sketch_mirror', { sketch: 'Plate', pieces: [3], axis: { sketchAxis: 'v' } })
  check(m.json?.made?.length === 1, `reverse_sketch_mirror: copy ${m.json?.made}`)
  const p = await ok('reverse_sketch_pattern', { sketch: 'Plate', pieces: [3], mode: 'circular', centre: 1, count: 4 })
  check(p.json?.made?.length === 3, `reverse_sketch_pattern circular about the circle: ${p.json?.made?.length} copies`)
  const s = await ok('reverse_sketch_spline', { sketch: 'Plate', piece: 4, rebuild: 7 })
  check(typeof s.json?.deviation === 'number', `reverse_sketch_spline rebuild 7: moved ${s.json?.deviation} mm`)
  const undoTitle = await page.$eval('[data-test="undo"]', (e) => e.title)
  check(undoTitle.startsWith('Undo: Agent: rebuild a spline'), `the undo key names the agent’s step: "${undoTitle}"`)

  const a = await ok('reverse_sketch_analyse', { sketch: 'Plate', tolerance: 0.1 })
  const circle = a.json?.pieces?.find((x) => x.id === 1), line = a.json?.pieces?.find((x) => x.id === 2)
  check(circle?.deviation?.within > 0.99 && circle?.curvature?.k === 0.1, `reverse_sketch_analyse: the circle on the wall within ${circle?.deviation?.within}, k ${circle?.curvature?.k}`)
  check(line?.deviation?.within > 0.05 && line.deviation.within < 0.4 && line.deviation.outside?.length >= 1, `reverse_sketch_analyse: the line leaving the wall within ${line?.deviation?.within}, ${line?.deviation?.outside?.length} stretch outside`)
  check(JSON.stringify(a.json?.deviation?.failing) === '[2]', `failing pieces ${JSON.stringify(a.json?.deviation?.failing)}`)

  // The person opens the sketch; the agent picks the two points it made.
  const row = await page.waitForSelector('[data-test^=explorer-history-feature-]', { timeout: 30000 })
  await row.click({ clickCount: 2 }); await sleep(800)
  if (!await page.$('[data-test=sketch-selection-count]')) {
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /^Edit /i.test(x.title || x.getAttribute('aria-label') || '') && (x.closest('li,div')?.textContent ?? '').includes('Plate')); b?.click() })
  }
  await page.waitForSelector('[data-test=sketch-selection-count]', { timeout: 30000 })
  const sel = await ok('reverse_sketch_select', { sketch: 'Plate', kind: 'point' })
  check(sel.json?.inEditor === true && sel.json.picked.length === 5, `reverse_sketch_select in the open editor: ${JSON.stringify(sel.json?.picked)}`)
  await page.waitForFunction(() => /5 selected/.test(document.querySelector('[data-test=sketch-selection-count]')?.textContent ?? ''), { timeout: 10000 }).catch(() => {})
  const count = await page.$eval('[data-test=sketch-selection-count]', (e) => e.textContent)
  const status = await page.evaluate(() => document.body.innerText.match(/The assistant selected[^\n]*/)?.[0] ?? '')
  check(/5 selected/.test(count) && /The assistant selected 5 sketch pieces/.test(status), `the panel shows the agent’s pick: "${count}", status "${status}"`)
  await page.screenshot({ path: out + '/agent-selected.png' })
  await page.keyboard.press('Escape'); await sleep(200)
  // The person finishes the sketch (OK): the agent's steps stay on the history.
  await page.click('[data-test=sketch-finish]'); await sleep(800)
  check(!await page.$('[data-test=sketch-selection-count]'), 'the sketch editor closed with OK')

  const undone = await ok('history_undo')
  check(/Agent: rebuild a spline/.test(JSON.stringify(undone.json?.undone ?? '')), `history_undo takes the agent’s step back: ${JSON.stringify(undone.json?.undone)}`)
} catch (e) {
  fail(String(e?.stack ?? e))
} finally {
  await finish(browser, consoleErrors)
  await agent.close().catch(() => {})
}
