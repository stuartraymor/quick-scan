// SPDX-License-Identifier: AGPL-3.0-only
// Parents, children and the delete cascade read from History entries, as
// QUICKSURFACE's dependency card and Delete confirmation show them.
import { describe, expect, it } from 'vitest'
import { childrenOf, dependencyCard, dependencyCascade } from '../src/core/explorerDependencies'

const entries = [
  { key: 'scan', label: 'Scan' },
  { key: 'core:element:1', label: 'Plane 1' },
  { key: 'reverse:feature:1', label: 'Sketch 1', parents: ['core:element:1'] },
  { key: 'reverse:feature:2', label: 'Extrude 1', parents: ['reverse:feature:1'] },
  { key: 'reverse:feature:3', label: 'Fillet 1', parents: ['reverse:feature:2', 'reverse:feature:2'] },
  { key: 'core:section:4', label: 'Section 4' },
  { key: 'reverse:feature:5', label: 'Sketch 2', parents: ['core:section:4', 'core:element:99'] },
]

describe('explorer dependencies', () => {
  it('lists direct children only', () => {
    expect(childrenOf('reverse:feature:1', entries).map((e) => e.label)).toEqual(['Extrude 1'])
    expect(childrenOf('scan', entries)).toEqual([])
  })

  it('cascades through grandchildren in document order', () => {
    expect(dependencyCascade(['core:element:1'], entries)).toEqual(['core:element:1', 'reverse:feature:1', 'reverse:feature:2', 'reverse:feature:3'])
    expect(dependencyCascade(['reverse:feature:3', 'core:section:4'], entries)).toEqual(['reverse:feature:3', 'core:section:4', 'reverse:feature:5'])
  })

  it('keeps asked keys the entries do not know', () => {
    expect(dependencyCascade(['gone:1'], entries)).toEqual(['gone:1'])
  })

  it('reads a card with parents, children and broken references', () => {
    expect(dependencyCard('reverse:feature:2', entries)).toEqual({ label: 'Extrude 1', parents: ['Sketch 1'], children: ['Fillet 1'] })
    expect(dependencyCard('reverse:feature:3', entries)?.parents).toEqual(['Extrude 1'])
    expect(dependencyCard('reverse:feature:5', entries)?.parents).toEqual(['Section 4', 'Unavailable reference'])
    expect(dependencyCard('missing', entries)).toBeNull()
  })
})
