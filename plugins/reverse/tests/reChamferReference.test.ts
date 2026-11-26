// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { firstChamferReference } from '../core/chamferSides'

it('shows the exact reference when edge adjacency is reversed or a multi-edge rim changes the vote', () => {
  const topology = { faces: [8,7,4].map(hash => ({hash})),
    edges: [{hash:2,faces:[4,8]}, {hash:3,faces:[4,7]}, {hash:5,faces:[8,8]}] }
  expect(firstChamferReference(topology,[2],false)).toBe(8)
  expect(firstChamferReference(topology,[2],true)).toBe(4)
  expect(firstChamferReference(topology,[2,3],false)).toBe(4)
  expect(firstChamferReference(topology,[2,3],true)).toBe(8)
  expect(firstChamferReference(topology,[2,5],false)).toBeUndefined()
  expect(firstChamferReference(topology,[42],false)).toBeUndefined()
})
