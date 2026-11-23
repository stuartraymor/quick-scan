// SPDX-License-Identifier: AGPL-3.0-only
// 1.2.15, Objects and History against QUICKSURFACE 8.0.128 side by side:
// the Parent/Child view the way QUICKSURFACE nests it, a plane's Flip and
// Lock, the scan's and the elements' master eyes saved with the project, and
// a delete asked of the agent finding what the browser lists.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { historyTree } from '../src/core/explorerDependencies'
import { useStore } from '../src/state/store'
import { useFlat } from '../src/state/flatStore'
import { useDeviation } from '../src/state/deviationStore'
import { useThickness } from '../src/state/thicknessStore'
import { useShell } from '../src/state/shellStore'
import { useDocumentOrder } from '../src/state/documentOrderStore'
import { clearHistory, configureHistory, installHistory, redo, undo } from '../src/state/historyStore'
import { flipCoreElement, lockCoreElement, renameCoreObject } from '../src/app/objectActions'
import { withFlips, type Element } from '../src/state/elementModel'
import { elementFromJson, elementToJson } from '../src/core/project/manifest'
import { applyScanPart, collectProject } from '../src/app/project'
import { fresh, sources } from './projectKit'

describe('the Parent/Child view (QUICKSURFACE: Extruded(1) ▸ Sketch(1))', () => {
  const entries = [
    { key: 'scan', label: 'Scan' },
    { key: 'core:element:1', label: 'Plane(1)' },
    { key: 'reverse:feature:1', label: 'Sketch(1)', parents: ['core:element:1'] },
    { key: 'reverse:feature:2', label: 'Extrude 1', parents: ['reverse:feature:1'] },
    { key: 'reverse:feature:3', label: 'Revolve 1', parents: ['reverse:feature:1'] },
    { key: 'core:element:4', label: 'Plane(2)' },
    { key: 'reverse:feature:5', label: 'Fillet 1', parents: ['reverse:feature:2', 'reverse:feature:2', 'reverse:feature:5'] },
  ]

  it('puts each feature on top with what it was built from inside it', () => {
    const { roots, children } = historyTree(entries)
    expect(roots.map((e) => e.label)).toEqual(['Scan', 'Revolve 1', 'Plane(2)', 'Fillet 1'])
    expect(children.get('reverse:feature:5')!.map((e) => e.label)).toEqual(['Extrude 1'])
    expect(children.get('reverse:feature:2')!.map((e) => e.label)).toEqual(['Sketch(1)'])
    expect(children.get('reverse:feature:1')!.map((e) => e.label)).toEqual(['Plane(1)'])
  })

  it('shows a shared input once, under the first feature after it, and names every user', () => {
    const { roots, children, consumersOf } = historyTree(entries)
    const shown = [...roots, ...[...children.values()].flat()].map((e) => e.key)
    expect(shown.sort()).toEqual(entries.map((e) => e.key).sort())
    expect(consumersOf.get('reverse:feature:1')).toEqual(['reverse:feature:2', 'reverse:feature:3'])
    expect(children.get('reverse:feature:3')).toBeUndefined()
  })

  it('ignores a link to itself, to a later entry or to a missing one', () => {
    const { roots } = historyTree([
      { key: 'a', parents: ['b', 'gone'] },
      { key: 'b', parents: ['b'] },
    ])
    expect(roots.map((e) => e.key)).toEqual(['a', 'b'])
  })
})

const plane = (id: number, extra: Partial<Element> = {}): Element => ({
  id, kind: 'plane', name: `Plane(${id})`, color: '#123456', visible: true, status: 'done',
  source: { type: 'constructed', method: 'plane-coords', refs: [], params: [0, 0, 1, 0, 0, 0] },
  fit: { kind: 'plane', center: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0], extentU: 10, extentV: 10, sigma: 0, usedPoints: 0, regionSize: 0 },
  ...extra,
}) as Element

describe('a plane turned over (Flip) and locked (Lock)', () => {
  let stops: (() => void)[] = []
  const m = () => useStore.getState()
  const fit = (id = 1) => m().elements.find((e) => e.id === id)!.fit as Extract<Element['fit'], { kind: 'plane' }>
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    useFlat.setState(useFlat.getInitialState(), true)
    useDeviation.setState(useDeviation.getInitialState(), true)
    useThickness.setState(useThickness.getInitialState(), true)
    useShell.getState().setWorkspace('elements')
    useDocumentOrder.setState(useDocumentOrder.getInitialState(), true)
    clearHistory()
    stops = [configureHistory({}), installHistory()]
    useStore.setState({ nextId: 2, elements: [plane(1)] })
  })
  afterEach(() => { for (const stop of stops.reverse()) stop() })

  it('Flip turns the normal over, keeps the frame right-handed, and is one undo step', async () => {
    expect(flipCoreElement(1)).toBe(true)
    expect(fit().normal).toEqual([-0, -0, -1])
    const [u, v, n] = [fit().basisU, fit().basisV, fit().normal]
    const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    for (let i = 0; i < 3; i++) expect(cross[i]).toBeCloseTo(n[i], 9)
    expect(m().elements[0].flipped).toBe(true)
    await undo()
    expect(fit().normal).toEqual([0, 0, 1])
    expect(m().elements[0].flipped).toBeUndefined()
    await redo()
    expect(fit().normal[2]).toBe(-1)
    expect(flipCoreElement(1)).toBe(true)
    expect(fit().normal[2]).toBe(1)
  })

  it('a fit worked out again stays flipped, and the flip is never applied twice', () => {
    const el = plane(1, { flipped: true })
    const once = withFlips([el])
    expect((once[0].fit as { normal: number[] }).normal[2]).toBe(-1)
    expect(withFlips(once)).toBe(once)
    // A fresh fit (no marker) for a flipped plane is turned over again.
    const refit = { ...once[0], fit: plane(1).fit }
    expect((withFlips([refit])[0].fit as { normal: number[] }).normal[2]).toBe(-1)
  })

  it('is saved and opens flipped', () => {
    flipCoreElement(1)
    const back = elementFromJson(JSON.parse(JSON.stringify(elementToJson(m().elements[0]))), m().settings)
    expect(back.flipped).toBe(true)
    expect(withFlips([back])[0]).toBe(back)
    expect((back.fit as { normal: number[] }).normal[2]).toBe(-1)
  })

  it('Flip is for planes, and refused while rolled back', () => {
    useStore.setState({ elements: [plane(1), { ...plane(2), kind: 'point', fit: { kind: 'point', center: [0, 0, 0], sigma: 0, usedPoints: 0, regionSize: 0 } } as unknown as Element] })
    expect(flipCoreElement(2)).toBe(false)
    useDocumentOrder.setState({ rollbackAt: 0 })
    expect(flipCoreElement(1)).toBe(false)
  })

  it('Lock keeps rename and Flip, is one undo step and is saved', async () => {
    expect(lockCoreElement(1, true)).toBe(true)
    expect(m().elements[0].locked).toBe(true)
    expect(lockCoreElement(1, true)).toBe(false)
    expect(renameCoreObject('element', 1, 'Datum A')).toBe(true)
    expect(flipCoreElement(1)).toBe(true)
    expect(elementToJson(m().elements[0]).locked).toBe(true)
    await undo()
    await undo()
    expect(m().elements[0].name).toBe('Plane(1)')
    await undo()
    expect(m().elements[0].locked).toBeUndefined()
    expect(lockCoreElement(1, false)).toBe(false)
  })
})

describe('the scan eye and the elements master eye are saved', () => {
  beforeEach(fresh)

  it('writes them only when shut, and opens them as saved', () => {
    expect(collectProject(sources(), null, '1.2.15').manifest.scan).not.toHaveProperty('scanHidden')
    useStore.getState().setScanHidden(true)
    useStore.getState().setElementsHidden(true)
    const part = collectProject(sources(), null, '1.2.15').manifest.scan!
    expect(part.scanHidden).toBe(true)
    expect(part.elementsHidden).toBe(true)
    useStore.getState().setScanHidden(false)
    useStore.getState().setElementsHidden(false)
    applyScanPart(JSON.parse(JSON.stringify(part)))
    expect(useStore.getState().scanHidden).toBe(true)
    expect(useStore.getState().elementsHidden).toBe(true)
  })

  it('opens an older project (no eyes recorded) with both shown', () => {
    useStore.getState().setScanHidden(true)
    const part = collectProject(sources(), null, '1.2.14').manifest.scan!
    delete part.scanHidden
    applyScanPart(part)
    expect(useStore.getState().scanHidden).toBe(false)
    expect(useStore.getState().elementsHidden).toBe(false)
  })
})
