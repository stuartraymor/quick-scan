// SPDX-License-Identifier: AGPL-3.0-only
import {beforeEach, describe, expect, it} from 'vitest'
import {useStore, type Element} from '../src/state/store'
import {alignmentReferences, alignmentPreview, alignmentSlotAccepts} from '../src/state/alignModel'
import {transformFit} from '../src/core/alignment'
const m=()=>useStore.getState()
const objects=()=>alignmentReferences([]).slice(0,4).map((e,i)=>({...e,id:i+1,name:`Test ${i+1}`}))
beforeEach(()=>{useStore.setState(useStore.getInitialState(),true);useStore.setState({elements:objects()});m().startAlignment()})
describe('explicit alignment reference interaction',()=>{
 it('refuses a stale assigned datum instead of silently applying a partial transform',()=>{
  m().setAlignmentRef('primary',1)
  m().setAlignmentRef('origin',-1020)
  useStore.setState({elements:[]})
  const result=alignmentPreview(m().alignDraft!,m().elements,100)
  expect(result.preview).toBeNull()
  expect(result.error).toContain('primary reference is unavailable')
 })
 it('cancels reference picking without cancelling alignment or losing the previous reference',()=>{
  m().setAlignmentRef('primary',1)
  m().beginAlignmentReferencePick('primary')
  m().cancelAlignmentPick()
  expect(m().alignDraft?.primary).toBe(1)
  expect(m().alignDraft?.referencePickSlot).toBeNull()
 })
 it('offers immutable planes, axes and origin without adding document objects',()=>{
  const refs=alignmentReferences(m().elements)
  expect(refs).toHaveLength(11)
  expect(new Set(refs.map(e=>e.id)).size).toBe(11)
  expect(refs.filter(e=>e.id<0).map(e=>e.name)).toEqual(['Top','Right','Front','X Axis','Y Axis','Z Axis','Origin'])
  expect(m().elements).toHaveLength(4)
 })
 it('replaces exactly the active slot and rejects invalid geometry without losing inputs',()=>{
  m().setAlignmentRef('primary',1)
  m().setAlignmentRef('secondary',3)
  m().beginAlignmentReferencePick('primary')
  m().selectAlignmentElement(2)
  expect(m().alignDraft?.primary).toBe(2)
  expect(m().alignDraft?.secondary).toBe(3)
  m().beginAlignmentReferencePick('origin')
  // QUICKSURFACE lists every feature for the tertiary: a plane gives its centre.
  m().selectAlignmentElement(1)
  expect(m().alignDraft?.origin).toBe(1)
  expect(m().alignDraft?.referencePickSlot).toBeNull()
  m().beginAlignmentReferencePick('origin')
  m().selectAlignmentElement(-1020)
  expect(m().alignDraft?.origin).toBe(-1020)
  expect(m().alignDraft?.referencePickSlot).toBeNull()
 })
 it('uses cylinder axes for directional slots, and its centre as a tertiary zero point',()=>{
  const cylinder:Element={...objects()[0],kind:'cylinder',fit:{kind:'cylinder',axis:[0,0,1],center:[4,5,6],radius:2,length:10,coverage:360,sigma:0,usedPoints:12,regionSize:12}}
  expect(alignmentSlotAccepts('primary',cylinder)).toBe(true)
  expect(alignmentSlotAccepts('secondary',cylinder)).toBe(true)
  expect(alignmentSlotAccepts('origin',cylinder)).toBe(true)
 })
 it('with Don’t move the coordinate system, only turns the part — no shift onto the feature',()=>{
  m().setAlignmentRef('primary',1)
  useStore.setState((st)=>({alignDraft:{...st.alignDraft!,keepOrigin:true}}))
  const kept=alignmentPreview(m().alignDraft!,m().elements,100).preview!
  expect(Array.from(kept.rigid.t)).toEqual([0,0,0])
 })
 it('preserves references while hiding geometry and keeps preview usable',()=>{
  m().setAlignmentRef('primary',1)
  const before=alignmentPreview(m().alignDraft!,m().elements,100)
  m().toggleElementVisible(1)
  expect(m().alignDraft?.primary).toBe(1)
  expect(alignmentPreview(m().alignDraft!,m().elements,100)).toEqual(before)
 })
 it('flips the selected directional constraint, twice restores it, without changing measured fits',()=>{
  m().setAlignmentRef('primary',1)
  m().setAlignmentAxis('primary','z+')
  const original=m().elements[0].fit!
  m().flipAlignmentAxis('primary')
  const preview=alignmentPreview(m().alignDraft!,m().elements,100).preview!
  const moved=transformFit(original,preview.rigid)
  expect(moved.kind).toBe('plane')
  if(moved.kind==='plane') expect(moved.normal[2]).toBeCloseTo(-1)
  m().flipAlignmentAxis('primary')
  expect(m().alignDraft?.primaryAxis).toBe('z+')
  expect(m().elements[0].fit).toBe(original)
 })
 it('reports parallel constraints and cancels without changing geometry',()=>{
  m().setAlignmentRef('primary',-1003)
  m().setAlignmentRef('secondary',-1013)
  expect(alignmentPreview(m().alignDraft!,m().elements,100).error).toBeTruthy()
  const original=m().elements
  m().cancelAlignment()
  expect(m().alignDraft).toBeNull()
  expect(m().elements).toBe(original)
 })
})
