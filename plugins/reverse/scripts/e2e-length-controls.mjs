// SPDX-License-Identifier: AGPL-3.0-only
// Render real controls and verify that display-unit edits preserve model millimetres.
import { launchApp, finish, check, fail } from '../../../scripts/e2e-lib.mjs'
const { browser, page, consoleErrors } = await launchApp()
try {
  // Isolate component state from the live application's workspace effects.
  await page.goto(new URL('/LICENSE', page.url()).href)
  const results = await page.evaluate(async () => {
    const { default: refresh } = await import('/@react-refresh')
    refresh.injectIntoGlobalHook(window)
    window.$RefreshReg$ = () => {}
    window.$RefreshSig$ = () => type => type
    window.__vite_plugin_react_preamble_installed__ = true
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { default: { flushSync } } = await import('/node_modules/.vite/deps/react-dom.js')
    const { usePrefs } = await import('/src/state/prefsStore.ts')
    const { useLengthDraft } = await import('/src/app/useLengthDraft.ts')
    const { NavigationCorner } = await import('/src/ui/NavigationCorner.tsx')
    const { useNavigationView } = await import('/src/state/navigationViewStore.ts')
    const { SketchExtractPanel } = await import('/plugins/reverse/ui/SketchExtractPanel.tsx')
    const { useSketchBrush } = await import('/plugins/reverse/state/sketchBrushStore.ts')
    const { useReverse } = await import('/plugins/reverse/state/reStore.ts')
    const { PolygonReductionDialog } = await import('/plugins/mesh-tools/ui/PolygonReductionDialog.tsx')
    const { useMeshTools } = await import('/plugins/mesh-tools/state/meshStore.ts')
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host), results = [], h = React.createElement
    const tick = () => new Promise(r => setTimeout(r, 50))
    const units = async u => { flushSync(() => usePrefs.getState().setUnits(u)); await tick() }
    const render = async (component, props) => { flushSync(() => root.render(h(component, props))); await tick() }
    const input = async (selector, text) => {
      const e = host.querySelector(selector)
      if (!e) throw new Error(`Missing control: ${selector}`)
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, text)
      e.dispatchEvent(new Event('input', { bubbles: true })); await tick()
    }
    let mm = 0
    function Draft() {
      const [text, set, value] = useLengthDraft(25.4); mm = value
      return h('input', { value: text, onChange: e => set(e.target.value) })
    }
    try {
      await units('mm'); await render(Draft)
      await units('in'); results.push([host.querySelector('input').value === '1' && mm === 25.4, '25.4 mm switches to 1 inch without changing physical length'])
      await input('input', '2'); await units('m')
      results.push([host.querySelector('input').value === '0.0508' && mm === 50.8, '2 inch input remains 50.8 mm when switched to metres'])
      await input('input', ''); results.push([host.querySelector('input').value === '', 'partially cleared numeric text is preserved'])
      await units('in'); await render(NavigationCorner, { scene: () => null, open: true })
      Array.from(host.querySelectorAll('button')).find(e => e.textContent.includes('Grid ...')).click(); await tick()
      await input('[aria-label="Grid spacing"]', '2'); host.querySelector('form').requestSubmit(); await tick()
      results.push([Math.abs(useNavigationView.getState().spacing - 50.8) < 1e-9, 'Grid dialog converts 2 inches to 50.8 model millimetres'])
      useReverse.getState().startSketch({ kind: 'world', axis: 'z', offset: 0 }, { origin: [0,0,0], normal: [0,0,1], basisU: [1,0,0], basisV: [0,1,0] })
      await tick(); useSketchBrush.getState().setOpen(true); useSketchBrush.getState().setPrimitive('curve')
      await render(SketchExtractPanel, { chainsOf: () => null })
      await input('[data-test="sketch-fit-tolerance"]', '0.01')
      results.push([Math.abs(useSketchBrush.getState().tolerance - .254) < 1e-9, 'Fit Curve tolerance converts inches into model millimetres'])
      await units('m')
      results.push([Math.abs(Number(host.querySelector('[data-test="sketch-fit-tolerance"]').value) - .000254) < 1e-12, 'Fit Curve tolerance updates its display when units change'])
      await units('in')
      await render(PolygonReductionDialog, { onPreview: async () => useMeshTools.setState({ report: { triangles: 4 } }), onReplace: async () => {}, onClose: () => {} })
      host.querySelector('[data-test="reduction-preview"]').click(); await tick()
      host.querySelector('[data-test="reduction-deviation"]').click(); await tick()
      const range = host.querySelector('[data-test="reduction-apply-range"]').previousElementSibling.previousElementSibling
      range.setAttribute('data-test', 'range')
      await input('[data-test="range"]', '0.5'); host.querySelector('[data-test="reduction-apply-range"]').click(); await tick()
      results.push([Math.abs(useMeshTools.getState().mapRange - 12.7) < 1e-9, 'Deviation range converts half an inch to 12.7 model millimetres'])
      return results
    } finally { root.unmount(); host.remove(); usePrefs.getState().setUnits('mm') }
  })
  for (const [passed, label] of results) check(passed, label)
} catch (error) { fail(String(error)) } finally { await finish(browser, consoleErrors) }
