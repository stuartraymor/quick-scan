// SPDX-License-Identifier: AGPL-3.0-only
// The Control Net tick of the Fit Surface box (F8 of
// audit-2026-11-07/FREEFORM_ROADMAP.md): the net drawn over the part as
// QUICKSURFACE draws it — the poles joined row by row and column by column,
// a point on each. Here: what the scene is given, and that it goes away.
import * as THREE from 'three'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { describe, expect, it } from 'vitest'
import { useControlNet } from '../state/controlNetStore'
import { BodyPicks, type BodyPicksContext } from '../viewer/bodyPicks'

function picks() {
  const partGroup = new THREE.Group()
  let invalidated = 0
  const ctx: BodyPicksContext = {
    partGroup,
    raycaster: new THREE.Raycaster(),
    camera: () => new THREE.PerspectiveCamera(),
    canvas: {} as HTMLElement,
    setPickRay: () => {},
    setDimmed: () => {},
    bodiesSolid: () => false,
    modelRadius: () => 100,
    invalidate: () => {
      invalidated++
    },
  }
  const bp = new BodyPicks(ctx)
  const group = partGroup.children[0] as THREE.Group
  return { bp, group, invalidated: () => invalidated }
}

const netOf = (rows: number, cols: number) => {
  const points = new Float64Array(rows * cols * 3)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) points.set([c * 10, r * 10, (r * c) % 3], (r * cols + c) * 3)
  return { rows, cols, points }
}

const lines = (g: THREE.Group) => g.children.filter((o): o is LineSegments2 => o instanceof LineSegments2)
const dots = (g: THREE.Group) => g.children.filter((o): o is THREE.Points => o instanceof THREE.Points)

describe('the control net drawn over the part', () => {
  it('joins the poles row by row and column by column and marks each pole', () => {
    const { bp, group } = picks()
    bp.setControlNet(netOf(3, 4))
    expect(lines(group)).toHaveLength(1)
    // 3 rows of 3 joins along v, 4 columns of 2 joins along u.
    expect(lines(group)[0].geometry.attributes.instanceStart.count).toBe(3 * 3 + 4 * 2)
    expect(dots(group)).toHaveLength(1)
    expect(dots(group)[0].geometry.attributes.position.count).toBe(12)
    // Drawn ahead of the surface it controls, so it shows through it.
    expect((lines(group)[0].material as THREE.Material).depthTest).toBe(false)
    expect((dots(group)[0].material as THREE.Material).depthTest).toBe(false)
  })

  it('puts the poles where the net has them', () => {
    const { bp, group } = picks()
    const net = netOf(2, 2)
    bp.setControlNet(net)
    const position = dots(group)[0].geometry.attributes.position
    for (let i = 0; i < 12; i++) expect(position.array[i]).toBeCloseTo(net.points[i], 5)
  })

  it('is replaced by a new net, not added to it, and goes when asked', () => {
    const { bp, group } = picks()
    bp.setControlNet(netOf(5, 5))
    bp.setControlNet(netOf(3, 3))
    expect(lines(group)).toHaveLength(1)
    expect(dots(group)).toHaveLength(1)
    expect(lines(group)[0].geometry.attributes.instanceStart.count).toBe(12)
    bp.setControlNet(null)
    expect(lines(group)).toHaveLength(0)
    expect(dots(group)).toHaveLength(0)
  })

  it('draws nothing from a net that is not whole', () => {
    const { bp, group } = picks()
    bp.setControlNet({ rows: 4, cols: 4, points: new Float64Array(9) })
    bp.setControlNet({ rows: 0, cols: 3, points: new Float64Array(0) })
    expect(lines(group)).toHaveLength(0)
    expect(dots(group)).toHaveLength(0)
  })

  it('is taken down with the scene', () => {
    const { bp, group } = picks()
    bp.setControlNet(netOf(4, 4))
    bp.dispose()
    expect(lines(group)).toHaveLength(0)
    expect(dots(group)).toHaveLength(0)
  })
})

describe('the Control Net tick', () => {
  it('starts off and is a view: set and cleared on its own', () => {
    expect(useControlNet.getState().on).toBe(false)
    useControlNet.getState().set(true)
    expect(useControlNet.getState().on).toBe(true)
    useControlNet.getState().set(false)
    expect(useControlNet.getState().on).toBe(false)
  })
})
