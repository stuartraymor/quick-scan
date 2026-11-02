// SPDX-License-Identifier: AGPL-3.0-only
// Setup uses real core actions; every tree action under test is UI-driven.
import { readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { launchApp, loadScan, repoFile, check, fail, finish, shotPath } from './e2e-lib.mjs'

const { browser, page, consoleErrors } = await launchApp({ protocolTimeout: 180000 })
const results = []
const record = (ok, label) => { check(ok, label); results.push({ ok: Boolean(ok), label }) }
const state = () => page.evaluate(() => {
  const s = window.__scanruler.measure.getState()
  return { elements: s.elements, sections: s.sections, draft: s.draft, sectionDraft: s.sectionDraft }
})
const context = async selector => {
  await page.click(selector, { button: 'right' })
  await page.waitForSelector('.explorer-core-menu', { visible: true })
}
const setWorkspace = workspace => page.evaluate(async workspace => {
  const { useShell } = await import('/src/state/shellStore.ts')
  useShell.getState().setWorkspace(workspace)
}, workspace)
try {
  await loadScan(page, repoFile(process.env.SCAN ?? 'public/reference-examples/basic_part.stl'))
  const plane = await page.evaluate(() => {
    const s = window.__scanruler.measure.getState()
    s.startDraft('plane'); s.setDraftMethod('plane-coords')
    s.setDraftParams([0, 0, 1, ...s.modelCenter]); s.setDraftName('Core tree datum')
    return s.commitDraft()
  })
  if (plane === null) throw Error('Core fixture plane did not commit')
  const planeName = await page.evaluate(id => window.__scanruler.measure.getState().elements.find(el => el.id === id).name, plane)
  await page.evaluate(() => {
    const s = window.__scanruler.measure.getState()
    s.startSection(); s.setSectionDraftRef('z')
  })
  await page.waitForFunction(() => window.__scanruler.measure.getState().sectionDraft?.status === 'ready')
  const section = await page.evaluate(() => window.__scanruler.measure.getState().commitSection())
  if (section === null) throw Error('Core fixture section did not commit')
  const planeRow = `[data-test="explorer-element-${plane}"]`
  const sectionRow = `[data-test="explorer-section-${section}"]`
  const planeEye = `[data-test="explorer-element-row-${plane}"] .explorer-checkbox`
  const sectionEye = `[data-test="explorer-section-row-${section}"] .explorer-checkbox`
  await page.waitForSelector(planeRow)
  record(await page.$(sectionRow), 'real plane and sliced section appear in Objects')
  await setWorkspace('thickness')
  await page.waitForFunction(selector => !document.querySelector(selector).disabled, {}, planeRow)
  await page.click(planeRow)
  record(!(await state()).draft, 'single-click selects a measured element without opening a draft')
  await context(sectionRow)
  record(await page.$eval(sectionRow, e => e.getAttribute('aria-pressed') === 'true'), 'right-click selects the clicked section rather than a previously selected plane')
  record(await page.$$eval('.explorer-core-menu [role=menuitem]', items => items.length === 1 && items[0].textContent === 'Edit ...'), 'context menu exposes real Edit only; unsupported reference actions are not placeholders')
  await page.keyboard.press('Escape')
  record(await page.$('.explorer-core-menu') === null, 'Escape dismisses core tree context menu')
  await context(planeRow)
  record(await page.$eval('.explorer-core-menu', menu => {
    const r = menu.getBoundingClientRect()
    return menu.parentElement === document.body && menu.contains(document.elementFromPoint(r.left + 10, r.bottom - 10))
  }), 'menu is portalled and clickable outside clipped tree containers')
  await page.click('[data-test=explorer-core-edit]')
  await page.waitForSelector('[data-test=cancel-draft]', { visible: true })
  record(await page.evaluate(async () => (await import('/src/state/shellStore.ts')).useShell.getState().workspace === 'elements'), 'Edit switches from an idle non-measurement workspace to the real element editor')
  record((await state()).draft?.editId === plane && (await state()).draft?.name === planeName, 'Edit restores original plane identity and name')
  record((await state()).draft?.method === 'plane-coords' && (await state()).draft?.params[2] === 1, 'Edit restores real construction method and normal values')
  record(await page.$eval(sectionRow, e => e.disabled) && await page.$eval(planeEye, e => e.disabled), 'other tree actions and visibility are blocked while an element is being edited')
  await page.click('[data-test=cancel-draft]')
  record(!(await state()).draft && (await state()).elements.length === 1, 'Cancel closes plane editing without duplicating or deleting geometry')
  await setWorkspace('thickness')
  await context(sectionRow)
  await page.click('[data-test=explorer-core-edit]')
  await page.waitForSelector('[data-test=cancel-section]', { visible: true })
  record((await state()).sectionDraft?.editId === section, 'section Edit restores the existing section identity outside measurement workspace')
  record((await state()).sectionDraft?.ref === 'z' && (await state()).sectionDraft?.frame?.normal[2] === 1, 'section Edit retains its plane and reference')
  await page.click('[data-test=cancel-section]')
  record(!(await state()).sectionDraft && (await state()).sections.length === 1, 'Cancel preserves the original sliced section')
  await setWorkspace('thickness')
  await page.click(planeEye)
  record((await state()).elements[0].visible === false && await page.$eval(planeEye, e => !e.checked), 'existing plane visibility control hides the real document element')
  await page.click(planeEye)
  record((await state()).elements[0].visible === true, 'plane visibility control restores the document element')
  await page.click(sectionEye)
  record((await state()).sections[0].visible === false && await page.$eval(sectionEye, e => !e.checked), 'existing section visibility control hides the real section')
  await page.click(sectionEye)
  record((await state()).sections[0].visible === true, 'section visibility control restores the section')
  await page.evaluate(async () => (await import('/src/state/shellStore.ts')).useShell.getState().setExtractOpen(true))
  record(await page.$eval(planeRow, e => e.disabled) && await page.$eval(sectionEye, e => e.disabled), 'active extraction blocks editing and visibility without losing the preview')
  await page.click(planeRow, { button: 'right' })
  record(await page.$('.explorer-core-menu') === null, 'active extraction cannot open a core tree action menu')
  await page.evaluate(async () => (await import('/src/state/shellStore.ts')).useShell.getState().setExtractOpen(false))
  await page.waitForFunction(selector => !document.querySelector(selector).disabled, {}, planeRow)
  await context(planeRow)
  await page.click('[data-test=explorer-core-edit]')
  await page.waitForSelector('[data-test=cancel-draft]', { visible: true })
  record((await state()).draft?.editId === plane, 'ending extraction restores guarded context-menu editing of the original plane')
  await page.click('[data-test=cancel-draft]')
  const downloads = resolve(process.env.SHOT_DIR ?? process.env.OUT_DIR ?? 'e2e-out')
  const cdp = await page.createCDPSession()
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads })
  await page.click('[data-test=save-project]')
  for (let n = 0; n < 120 && !readdirSync(downloads).some(name => name.endsWith('.scanruler')); n++) await new Promise(done => setTimeout(done, 250))
  record(readdirSync(downloads).some(name => name.endsWith('.scanruler')), 'Basic Part plus plane and section saved without active drafts for installed replay')
  await page.screenshot({ path: shotPath('explorer-core.png') })
} catch (error) { fail(error.stack ?? String(error)) }
finally {
  writeFileSync(shotPath('explorer-core-results.json'), JSON.stringify(results, null, 2))
  await finish(browser, consoleErrors)
}
