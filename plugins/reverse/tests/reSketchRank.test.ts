// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { countBelowThreshold } from '../core/sketchRank'
import { symmetricEigenN } from '../../../src/core/fit/linalg'

it.each([6, 16, 33, 70])('matches the spectral redundancy count for %i connected and disconnected equations', size => {
  let state = 4705
  const random = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 2 ** 32 - .5 }
  const rows: number[][] = []
  for (let i = 0; i < size; i++) {
    const row = Array.from({ length: size }, (_, j) => i % 3 === j % 3 ? random() : 0)
    if (i % 5 === 4) rows.push(rows[i - 2].map((v, j) => v + (i % 2 ? 0 : .0002) * row[j]))
    else rows.push(row)
  }
  const gram = Float64Array.from({ length: size * size }, (_, a) => {
    const u = rows[Math.floor(a / size)], v = rows[a % size]
    return u.reduce((sum, value, j) => sum + value * v[j], 0)
  })
  const original = gram.slice()
  const spectrum = symmetricEigenN(size, gram).values
  for (const cutoff of [1e-6, 1e-4, .1, 1]) {
    expect(countBelowThreshold(gram, size, cutoff)).toBe(spectrum.filter(v => v < cutoff).length)
  }
  expect(gram).toEqual(original)
})

it('keeps the strict cutoff and handles a zero diagonal shift', () => {
  const size = 20, gram = new Float64Array(size * size)
  for (let i = 0; i < size; i++) gram[i * size + i] = 1
  gram[1] = gram[size] = .25
  expect(countBelowThreshold(gram, size, 1)).toBe(1)
})
