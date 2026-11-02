// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, expect, it } from 'vitest'
import { run, refused, startHeadless, undoLabels, type Headless } from './commandKit'
import { useStore } from '../src/state/store'

let engine: Headless
beforeAll(async () => { engine = await startHeadless() })
afterAll(() => engine.stop())

it('fits a marked edge through the shared command path, with one undo/redo step', async () => {
  const obj: string[] = []
  for (let x = 0; x <= 30; x++) for (const y of [-0.01, 0.01]) obj.push(`v ${x} ${y} 3`)
  for (let x = 0; x < 30; x++) { const a = 2*x+1; obj.push(`f ${a} ${a+2} ${a+3}`, `f ${a} ${a+3} ${a+1}`) }
  await run('scan.open', { bytes: new TextEncoder().encode(obj.join('\n')), name: 'edge.obj', discard: true })
  await run('element.fit_marked', { kind: 'line', vertices: Array.from({ length: 62 }, (_, i) => i), name: 'Agent edge' })
  const el = useStore.getState().elements[0]
  expect(el.name).toBe('Agent edge')
  expect(el.fit?.kind).toBe('line')
  expect(el.fit?.kind === 'line' && el.fit.length).toBeCloseTo(30, 6)
  expect(el.source.type).toBe('fitted')
  expect(undoLabels()).toEqual(['Agent: fit line to a marked surface'])
  await run('history.undo')
  expect(useStore.getState().elements).toHaveLength(0)
  await run('history.redo')
  expect(useStore.getState().elements).toHaveLength(1)
  expect((await refused('element.fit_marked', { kind: 'line', vertices: [999999] })).code).toBe('invalid_input')
})
