// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest'
import { extractQuickPlacement } from '../src/ui/extractQuickPlacement'
const view = { left: 235, top: 200, right: 1139, bottom: 900 }
const panel = { left: 244, top: 220, right: 530, bottom: 800 }
describe('quick-tools safe placement', () => {
 it('matches the observed centred, raised reference position when unobstructed', () => {
  expect(extractQuickPlacement({x:800,y:500},view,panel)).toEqual({left:707,top:368,width:186})
 })
 it.each([{x:236,y:201},{x:1138,y:201},{x:236,y:899},{x:1138,y:899},{x:540,y:450}])('keeps edge picks inside the viewport and away from the inspector: %j', point => {
  const p=extractQuickPlacement(point,view,panel)
  expect(p.left).toBeGreaterThanOrEqual(view.left+8);expect(p.left+p.width).toBeLessThanOrEqual(view.right-8)
  expect(p.top).toBeGreaterThanOrEqual(view.top+8);expect(p.top+70).toBeLessThanOrEqual(view.bottom-8)
  expect(p.left>=panel.right+8||p.left+p.width<=panel.left-8||p.top>=panel.bottom+8||p.top+70<=panel.top-8).toBe(true)
 })
})
