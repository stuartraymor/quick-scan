// SPDX-License-Identifier: AGPL-3.0-only
// Extract primitives' constraints on a real fit: two planar patches (stacked in Y, clear of the dialog) a hair off
// parallel, fitted with the wand. Auto Constrain snaps the second onto the
// first; the dropdown holds a normal to a coordinate plane; Analysis lists the
// points beyond its tolerance.
import { writeFileSync } from 'node:fs'
import { launchApp, loadScan, check, fail, finish, shotPath } from './e2e-lib.mjs'

const T1 = Math.tan((0.3 * Math.PI) / 180), T2 = Math.tan((0.2 * Math.PI) / 180)
const verts = [], faces = []
for (const [y0, z0, tilt, axis] of [[0, 3, T1, 'y'], [40, 3.4, T2, 'x']]) {
  const base = verts.length
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
    const px = x * 3, py = y0 + y * 3
    verts.push(`v ${px} ${py} ${z0 + (axis === 'y' ? py - y0 : px) * tilt}`)
  }
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const a = base + y * 9 + x + 1
    faces.push(`f ${a} ${a + 1} ${a + 10}`, `f ${a} ${a + 10} ${a + 9}`)
  }
}
const fixture = shotPath('two-patches.obj')
writeFileSync(fixture, [...verts, ...faces].join('\n'))

const { browser, page, consoleErrors } = await launchApp({ agentDataOk: false })
try {
  await loadScan(page, fixture)
  const state = () => page.evaluate(async () => {
    const { useStore } = await import('/src/state/store.ts')
    const { useExtract } = await import('/src/state/extractStore.ts')
    const s = useStore.getState()
    return {
      elements: s.elements.map((e) => ({ name: e.name, kind: e.fit?.kind, n: e.fit?.normal, c: e.fit?.center, sigma: e.fit?.sigma })),
      draft: s.draft?.fit ? { n: s.draft.fit.normal, c: s.draft.fit.center, sigma: s.draft.fit.sigma } : null,
      status: s.statusText,
      analysed: useExtract.getState().analysed,
    }
  })
  const clickAt = async (x, y, z) => {
    const hit = await page.evaluate(([x, y, z]) => {
      const scene = window.__scanruler.scene(), mesh = scene.marking.ctx.mesh()
      const p = mesh.position.clone().set(x, y, z); mesh.localToWorld(p); p.project(scene.viewLink().camera)
      const r = document.querySelector('.viewport canvas').getBoundingClientRect()
      return { x: r.x + (p.x + 1) * r.width / 2, y: r.y + (1 - p.y) * r.height / 2 }
    }, [x, y, z])
    await page.mouse.click(hit.x, hit.y)
  }
  const fitPlane = async () => {
    await page.waitForFunction(() => !document.querySelector('[data-test=extract-type-plane]')?.disabled)
    await page.click('[data-test=extract-type-plane]')
    await page.waitForSelector('[data-test=extract-preview]')
  }
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

  await page.click('[data-test=ribbon-extract-primitives]')
  if (await page.$eval('[data-test=extract-tool-wand]', el => el.getAttribute('aria-pressed') !== 'true')) await page.click('[data-test=extract-tool-wand]')
  // Auto Constrain opens on, as QUICKSURFACE's does; this script makes its
  // first plane free and turns Auto Constrain on itself.
  await page.evaluate(async () => (await import('/src/state/extractStore.ts')).useExtract.getState().setAutoConstrain(false))

  // Plane 1: the first patch, unconstrained.
  await clickAt(12, 12, 3 + 12 * T1)
  await page.waitForSelector('[data-test=extract-quick]')
  await fitPlane()
  await page.click('[data-test=extract-create-stay]')
  const first = (await state()).elements[0]
  check(first?.kind === 'plane' && Math.abs(first.n[2]) < 1 && Math.abs(first.n[1]) > 1e-3, 'Plane 1 is fitted tilted, as the scan is')

  // Auto Constrain: the second patch is 0.2 degrees from parallel and 0.4 mm away.
  check(await page.$('[data-test=extract-tilt]') === null, 'Create & Stay hides fit-only controls until the next fit')
  await clickAt(12, 52, 3.4 + 12 * T2)
  await page.waitForSelector('[data-test=extract-quick]')
  await fitPlane()
  check(await page.$eval('[data-test=extract-tilt]', e => e.disabled), 'Tilt tolerance stays greyed until Auto Constrain is on')
  await page.click('[data-test=extract-auto-constrain]')
  check(await page.$eval('[data-test=extract-tilt]', e => !e.disabled && e.value === '0.5') && await page.$eval('[data-test=extract-coincidence]', e => !e.disabled && e.value === '1'), 'Auto Constrain opens Tilt 0.5 degrees and Coincidence 1 mm')
  await page.waitForFunction(() => !document.querySelector('[data-test=extract-create-stay]')?.disabled && !!document.querySelector('[data-test=extract-preview]'))
  let st = await state()
  check(st.status.includes(`parallel to ${first.name}`) && st.status.includes(`coincident with ${first.name}`), `the status says what was snapped: ${st.status}`)
  check(Math.abs(dot(st.draft.n, first.n)) > 1 - 1e-9, 'the new plane is exactly parallel to Plane 1')
  check(Math.abs(dot(first.n, [st.draft.c[0] - first.c[0], st.draft.c[1] - first.c[1], st.draft.c[2] - first.c[2]])) < 1e-6, 'and lies in Plane 1 (coincident)')
  await page.click('[data-test=extract-create-stay]')
  check((await state()).elements.length === 2, 'it is created as a second plane')

  // Dropdown: hold the first patch's plane parallel to OXY.
  await clickAt(12, 12, 3 + 12 * T1)
  await page.waitForSelector('[data-test=extract-quick]')
  await fitPlane()
  await page.click('[data-test=extract-auto-constrain]')
  await page.waitForSelector('[data-test=extract-preview]')
  const free = (await state()).draft
  await page.select('[data-test=extract-constraint]', 'parallel-oxy')
  await page.waitForFunction(async () => (await import('/src/state/store.ts')).useStore.getState().draft?.fit?.normal?.[2] === 1)
  const held = (await state()).draft
  check(held.n[2] === 1 && held.n[0] === 0 && held.n[1] === 0, 'Parallel to (OXY) holds the normal along Z')
  check(held.sigma > free.sigma, `σ rises honestly when the scan disagrees (${free.sigma.toFixed(4)} to ${held.sigma.toFixed(4)} mm)`)

  // Analysis: points further than the tolerance from the held plane.
  await page.click('[data-test=extract-analysis]')
  await page.$eval('[data-test=extract-analysis-tolerance]', (e) => { e.focus() })
  await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await page.keyboard.type('0.05')
  await page.click('[data-test=extract-analysis-apply]')
  await page.waitForSelector('[data-test=extract-analysis-result]')
  const found = (await state()).analysed
  check(found && found.total === 81 && found.far > 0 && found.far < 81 && found.worst > 0.05, `Analysis lists ${found?.far} of ${found?.total} points beyond 0.05 mm, the worst ${found?.worst?.toFixed(3)}`)
  await page.screenshot({ path: shotPath('extract-constrain.png') })
  await page.click('[data-test=extract-analysis]')
  check(await page.$('[data-test=extract-analysis-result]') === null, 'Analysis off clears its result')
  await page.click('[data-test=extract-create]')
  const done = await state()
  check(done.elements.length === 3 && done.elements[2].n[2] === 1, 'Create keeps the held plane as the third element')
} catch (error) {
  fail(error.stack ?? String(error))
} finally {
  await finish(browser, consoleErrors)
}
