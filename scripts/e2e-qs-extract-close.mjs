// SPDX-License-Identifier: AGPL-3.0-only
// Real fit on a synthetic plane; exercise every exit-confirmation choice.
import { writeFileSync } from 'node:fs'
import { launchApp, loadScan, check, fail, finish, shotPath } from './e2e-lib.mjs'

const mesh = []
for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) mesh.push(`v ${x * 5} ${y * 5} 3`)
for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
  const a = y * 5 + x + 1
  mesh.push(`f ${a} ${a + 1} ${a + 6}`, `f ${a} ${a + 6} ${a + 5}`)
}
const fixture = shotPath('synthetic-plane.obj')
writeFileSync(fixture, mesh.join('\n'))
const { browser, page, consoleErrors } = await launchApp({ agentDataOk: false })
try {
  await loadScan(page, fixture)
  const state = () => page.evaluate(async () => {
    const { useStore } = await import('/src/state/store.ts')
    const { useShell } = await import('/src/state/shellStore.ts')
    const { useMark } = await import('/src/state/markStore.ts')
    const s = useStore.getState()
    return { elements: s.elements.length, draft: !!s.draft, open: useShell.getState().extractOpen, selected: useMark.getState().count, paintColor: window.__scanruler.scene().marking.paint?.color }
  })
  const preview = async () => {
    await page.click('[data-test=ribbon-extract-primitives]')
    await page.click('[data-test=extract-select-all]')
    await page.waitForFunction(() => !document.querySelector('[data-test=extract-type-plane]')?.disabled)
    if (await page.$eval('[data-test=extract-tool-wand]', el => el.getAttribute('aria-pressed') !== 'true')) await page.click('[data-test=extract-tool-wand]')
    const hit = await page.evaluate(() => {
      const scene = window.__scanruler.scene(), mesh = scene.marking.ctx.mesh()
      const p = mesh.position.clone().set(10, 10, 3); mesh.localToWorld(p); p.project(scene.viewLink().camera)
      const r = document.querySelector('.viewport canvas').getBoundingClientRect()
      return { x: r.x + (p.x + 1) * r.width / 2, y: r.y + (1 - p.y) * r.height / 2 }
    })
    await page.mouse.click(hit.x, hit.y)
    await page.waitForSelector('[data-test=extract-quick]')
    await page.click('[data-test=extract-type-plane]')
    await page.waitForSelector('[data-test=extract-preview]')
  }
  await preview()
  check((await state()).elements === 0 && (await state()).draft, 'fitting previews the plane without committing it')
  check(await page.$('[data-test=extract-quick]') === null, 'quick tools dismiss when a fit preview appears')
  check((await state()).paintColor === '#ffffff', 'extraction keeps its white selection while previewing a primitive')
  check(await page.$eval('[data-test=extract-preview]', el => el.scrollWidth <= el.clientWidth + 1), 'preview controls fit inside the command panel')
  const selected = (await state()).selected
  await page.click('[data-test=extract-clear-preview]')
  check(!(await state()).draft && (await state()).open && (await state()).selected === selected, 'Clear removes the preview and preserves all selected points')
  check((await state()).paintColor === '#ffffff', 'Clear keeps the extraction selection white')
  check(await page.$('[data-test=extract-preview]') === null, 'Clear removes preview controls')
  await page.click('[data-test=extract-type-plane]')
  await page.waitForSelector('[data-test=extract-preview]')
  check((await state()).selected === selected && (await state()).draft, 'the retained selection can be refitted without marking it again')
  await page.click('[data-test=hide-tool-inspector]')
  await page.waitForSelector('[role=alertdialog]')
  check((await state()).draft && (await state()).open, 'the command panel X asks before losing a preview')
  await page.keyboard.press('Escape')
  check(await page.$('[role=alertdialog]') === null && (await state()).draft && (await state()).open, 'Escape cancels the exit question and preserves the preview')
  await page.click('[data-test=extract-close]')
  await page.click('[data-test=extract-close-cancel]')
  check((await state()).draft && (await state()).open, 'Cancel keeps the draft and extraction command')
  await page.click('[data-test=extract-close]')
  await page.click('[data-test=extract-close-no]')
  check(!(await state()).draft && !(await state()).open && (await state()).elements === 0, 'No exits without committing the preview')
  await preview()
  await page.click('[data-test=extract-close]')
  await page.screenshot({ path: shotPath('extract-close-confirmation.png') })
  await page.click('[data-test=extract-close-yes]')
  const kept = await state()
  check(!kept.draft && !kept.open && kept.elements === 1, 'Yes commits exactly one primitive and exits cleanly')
  check(await page.evaluate(async () => {
    const { useStore } = await import('/src/state/store.ts')
    const fit = useStore.getState().elements[0]?.fit
    return fit?.kind === 'plane' && Math.abs(fit.center[2] - 3) < 1e-8 && Math.abs(Math.abs(fit.normal[2]) - 1) < 1e-8 && fit.sigma < 1e-8
  }), 'the committed plane has Z=3 mm, a vertical normal and negligible fit error')
  await preview()
  await page.click('[data-test=extract-create-stay]')
  check((await state()).elements === 2 && (await state()).open && !(await state()).draft, 'Create & Stay commits one primitive and resets the command for the next')
  check((await state()).selected === 0, 'Create & Stay clears the old selection')
  await page.click('[data-test=extract-select-all]')
  await page.waitForFunction(() => !document.querySelector('[data-test=extract-type-plane]')?.disabled)
  await page.click('[data-test=extract-type-plane]')
  await page.waitForSelector('[data-test=extract-preview]')
  await page.click('[data-test=extract-create]')
  check((await state()).elements === 3 && !(await state()).open && !(await state()).draft, 'Create commits one primitive and exits the command')
  await page.evaluate(async () => (await import('/src/state/historyStore.ts')).undo())
  check((await state()).elements === 2, 'Undo removes the last committed extraction')
  await page.evaluate(async () => (await import('/src/state/historyStore.ts')).redo())
  check((await state()).elements === 3, 'Redo restores the extraction')
  await page.click('[data-test=ribbon-extract-primitives]')
  await page.click('[data-test=extract-close]')
  check(!(await state()).open && await page.$('[role=alertdialog]') === null, 'closing without a preview needs no confirmation')
} catch (error) {
  fail(error.stack ?? String(error))
} finally {
  await finish(browser, consoleErrors)
}
