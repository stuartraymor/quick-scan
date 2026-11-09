// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { projectedArrowStep, screenArrowStep, screenPoleHandle } from '../viewer/screenPoleGizmo'

it('matches measured native Screen horizontal-arrow trajectories', () => {
  const mm = 15.594033185 / 70
  expect(screenArrowStep(70, 0, 'x') * mm).toBeCloseTo(15.59403296, 5)
  expect(screenArrowStep(0, -35, 'x')).toBe(0)
  expect(screenArrowStep(70, -35, 'x') * mm).toBeCloseTo(19.492542635, 5)
  let total = 0, previous = 0
  for (let i = 1; i <= 14; i++) {
    const y = -Math.round(2.5 * i)
    total += screenArrowStep(5, y - previous, 'x'); previous = y
  }
  expect(total * mm).toBeCloseTo(19.64848336, 5)
})

it('keeps the two arrow and planar hit regions separate from the selected pole', () => {
  expect(screenPoleHandle(80, 0)).toBe('x')
  expect(screenPoleHandle(0, -80)).toBe('y')
  expect(screenPoleHandle(40, -40)).toBe('plane')
  expect(screenPoleHandle(0, 0)).toBeNull()
  expect(screenPoleHandle(-80, 0)).toBeNull()
})

it('matches the independently measured native vertical-arrow diagonal', () => {
  const up70 = [-7.797017046, 7.797016705, 19.098714146]
  const native = [-9.746271048, 9.746270622, 23.873392048]
  const scale = screenArrowStep(35, -70, 'y') / -70
  up70.forEach((x, i) => expect(Math.abs(x * scale - native[i])).toBeLessThan(1e-6))
})

it('matches native World-X displacement using the independent Screen calibration', () => {
  // Screen-right is equal positive world X/Y in this preserved view.
  // Its 70px free drag gave15.594033185mm in each coordinate.
  const projectedX = 70 / (2 * 15.594033185)
  expect(Math.abs(projectedArrowStep(70, 0, projectedX, 0) - 31.188067674)).toBeLessThan(2e-6)
})
