// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { Feature, FreeformFeature } from '../core/features'
import { type Cage, topology } from '../core/freeform/cage'
import { combineCages, combineFreeforms } from '../core/freeform/combine'
import { cageVertexLimits } from '../core/freeform/limit'
import { mergeBoundaryEdge } from '../core/freeform/merge'
import { collectReversePart, applyReversePart, validateReversePart } from '../app/projectSection'
import { useReverse } from '../state/reStore'
import { useFreeformEditor } from '../state/freeformEditorStore'
import { resetReverse } from './reReset'
import reversePlugin from '../plugin'
import { configureHistory, installHistory, undo, redo, useHistory } from '../../../src/state/historyStore'
import { useShell } from '../../../src/state/shellStore'

const feature = (id: number, dx = 0): FreeformFeature => ({ id, kind: 'freeform', name: `Patch ${id}`, positions: [0+dx,0,0,5+dx,0,0,5+dx,5,.3,0+dx,5,0], faces: [[0,1,2,3]], creases: [[0,1]], steps: 2, snap: false, fitToScan: false, visible: true })
const cage = (f: FreeformFeature): Cage => ({ positions: Float64Array.from(f.positions), faces: f.faces, creases: f.creases })
beforeEach(() => { resetReverse(); useFreeformEditor.getState().setOpen(false) })
afterEach(() => { resetReverse(); useFreeformEditor.getState().setOpen(false) })

it('combines coincident objects without welding and preserves both evaluated components exactly', () => {
  const a = feature(4), b = feature(7), before = structuredClone([a,b]), result = combineFreeforms([a,b])
  expect(result).toMatchObject({id:4,name:'Patch 4',steps:2,fitToScan:false})
  expect(result.positions).toEqual([...a.positions,...b.positions])
  expect(result.faces).toEqual([[0,1,2,3],[4,5,6,7]])
  expect(result.creases).toEqual([[0,1],[4,5]])
  expect(topology(cage(result)).edges.filter(e => e.faces.length === 2)).toHaveLength(0)
  expect(cageVertexLimits(cage(result))).toEqual([...cageVertexLimits(cage(a)),...cageVertexLimits(cage(b))])
  expect([a,b]).toEqual(before)
  result.positions[0] = 99; result.faces[0][0] = 99; result.creases[0][0] = 99
  expect([a,b]).toEqual(before)
})

it('allows a subsequent explicit seam weld between the combined components', () => {
  const a=feature(1),b=feature(2,5)
  a.positions=a.positions.map((v,i)=>i%3===2?0:v);b.positions=b.positions.map((v,i)=>i%3===2?0:v)
  const combined=combineCages([cage(a),cage(b)])
  expect(combined.positions.length/3).toBe(8)
  const joined=mergeBoundaryEdge(combined,[1,2],[4,7]).cage
  expect(joined.positions.length/3).toBe(6)
  expect(topology(joined).edges.filter(e=>e.faces.length===2)).toHaveLength(1)
})

it.each([
  {steps:3}, {fitToScan:true}, {fitToScan:undefined}, {snap:true}, {snapType:'ray' as const}, {refitTolerance:.01},
  {snapRegion:{point:[0,0,0],dir:[0,0,1],radius:2,u:[1,0,0],v:[0,1,0],t0:0,t1:5,start:0,sweep:1,margin:.1} as const},
])('refuses incompatible evaluation settings %j without changing either source', patch => {
  const sources=[feature(1),{...feature(2),...patch} as FreeformFeature],before=structuredClone(sources)
  expect(()=>combineFreeforms(sources)).toThrow(/same refinement/)
  expect(sources).toEqual(before)
})

it('accepts equivalent legacy fit semantics and identical regions regardless of property insertion order', () => {
  const a=feature(1),b=feature(2),r={point:[0,0,0],dir:[0,0,1],radius:2,u:[1,0,0],v:[0,1,0],t0:0,t1:5,start:0,sweep:1,margin:.1}
  delete a.fitToScan;b.fitToScan=true
  a.snapRegion=r as FreeformFeature['snapRegion'];b.snapRegion=Object.fromEntries(Object.entries(r).reverse()) as unknown as FreeformFeature['snapRegion']
  expect(combineFreeforms([a,b]).fitToScan).toBeUndefined()
})

it.each([{suppressed:true},{ask:{kind:'offset',distance:1}},{fromSketch:{network:9,resolution:2}}])('refuses unsupported source options %j', options => {
  expect(()=>combineFreeforms([feature(1),{...feature(2),...options} as FreeformFeature])).toThrow()
})

it('refuses malformed face, crease and finite-position references before combining', () => {
  const good=cage(feature(1))
  for(const bad of [
    {...good,positions:Float64Array.of(0,0,NaN)}, {...good,faces:[[0,1,2,8]]},
    {...good,faces:[[0,1,2,1]]}, {...good,creases:[[0,2]] as [number,number][]},
    {...good,faces:[[0,1,2,3],[3,2,1,0]]},
  ]) expect(()=>combineCages([good,bad])).toThrow()
})

const install=()=>{
  const features=[feature(1),feature(2,10)]
  useReverse.setState({features,nextFeatureId:3,nextOfKind:{freeform:3},bodyStyles:{1:{name:'First'},2:{name:'Second'}},bodyFolders:[{id:1,name:'Group',parent:null,bodies:[1,2]}]})
  return features
}

it('merges as one undo step, preserves the first requested identity and restores exact sources on undo/redo', () => {
  const originals=install(),before=useReverse.getState(),id=before.mergeFreeforms([2,1]),merged=useReverse.getState()
  expect(id).toBe(2);expect(merged.features).toHaveLength(1)
  expect(merged.features[0]).toMatchObject({id:2,name:'Patch 2',positions:[...originals[1].positions,...originals[0].positions]})
  expect(merged.past).toHaveLength(before.past.length+1);expect(merged.buildVersion).toBe(before.buildVersion+1)
  expect(merged.nextFeatureId).toBe(3);expect(merged.nextOfKind).toEqual(before.nextOfKind)
  expect(merged.bodyStyles).toEqual({2:{name:'Second'}});expect(merged.bodyFolders[0].bodies).toEqual([2])
  merged.undoFeatures();expect(useReverse.getState().features).toEqual(originals)
  expect(useReverse.getState().bodyStyles).toEqual(before.bodyStyles);expect(useReverse.getState().bodyFolders).toEqual(before.bodyFolders)
  useReverse.getState().redoFeatures();expect(useReverse.getState().features).toEqual(merged.features)
})

it('persists the combined control cage through the existing project format', () => {
  install();useReverse.getState().mergeFreeforms([1,2])
  const expected=structuredClone(useReverse.getState().features)
  const part=validateReversePart(JSON.parse(JSON.stringify(collectReversePart())))
  applyReversePart(part)
  expect(useReverse.getState().features).toEqual(expected)
  expect(topology(cage(useReverse.getState().features[0] as FreeformFeature)).edges).toHaveLength(8)
})

it('registers object Merge as one global keyboard Undo/Redo action', async()=>{
  reversePlugin.install?.()
  const unconfigure=configureHistory({}),uninstall=installHistory()
  const workspace=useShell.getState().workspace
  try {
    useShell.getState().setWorkspace('reverse')
    const original=install()
    useReverse.getState().mergeFreeforms([1,2])
    const merged=structuredClone(useReverse.getState().features)
    expect(useHistory.getState().past).toHaveLength(1)
    await undo();expect(useReverse.getState().features).toEqual(original)
    await redo();expect(useReverse.getState().features).toEqual(merged)
    expect(useHistory.getState().past).toHaveLength(1)
  } finally { uninstall();unconfigure();useShell.getState().setWorkspace(workspace) }
})

it.each([[],[1],[1,1],[1,99],[1,1.5]].map(ids=>({ids})))('refuses invalid object selection $ids without a history or state change', ({ids})=>{
  install();const before=useReverse.getState()
  expect(()=>before.mergeFreeforms(ids)).toThrow(/Select|Every selected/);expect(useReverse.getState()).toBe(before)
})

it('refuses non-Freeform sources, suppressed sources and incompatible settings atomically',()=>{
  for(const second of [{id:2,kind:'import',name:'CAD',file:{name:'x',key:'x'},visible:true},{...feature(2),suppressed:true},{...feature(2),steps:3}] as Feature[]) {
    install();useReverse.setState(s=>({features:[s.features[0],second]}));const before=useReverse.getState()
    expect(()=>before.mergeFreeforms([1,2])).toThrow();expect(useReverse.getState()).toBe(before)
  }
})

it('refuses active and rolled-back dependencies, including CAD conversion provenance',()=>{
  for(const rolledBack of [false,true]) {
    const originals=install(), dependent={id:3,kind:'import',name:'Converted body',file:{name:'x',key:'x'},freeformSource:2,visible:true} as Feature
    useReverse.setState(rolledBack?{rolledBack:[dependent]}:{features:[...originals,dependent]})
    const before=useReverse.getState();expect(()=>before.mergeFreeforms([1,2])).toThrow();expect(useReverse.getState()).toBe(before)
  }
})

it('refuses build, history playback, rollback and open editor states atomically',()=>{
  for(const state of [{building:true},{playback:{origin:2,at:2,playing:false}},{rolledBack:[feature(3)]}]) {
    resetReverse();install();useReverse.setState(state);const before=useReverse.getState()
    expect(()=>before.mergeFreeforms([1,2])).toThrow();expect(useReverse.getState()).toBe(before)
  }
  resetReverse();install();useFreeformEditor.getState().editFeature(1);const before=useReverse.getState()
  expect(()=>before.mergeFreeforms([1,2])).toThrow(/editor/);expect(useReverse.getState()).toBe(before)
})

it('builds both combined curved components as valid CAD with unchanged total surface area', async()=>{
  const { ReKernel }=await import('../core/kernel'), {freeformBody}=await import('../core/freeform/make')
  const k=await ReKernel.load(),a=cage(feature(1)),b=cage(feature(2,10)),shapes=[]
  try {
    for(const c of [a,b,combineCages([a,b])]) shapes.push(freeformBody(k,c,{steps:2,snap:false}).shape)
    expect(k.isValid(shapes[2])).toBe(true)
    expect(k.surfaceArea(shapes[2])).toBeCloseTo(k.surfaceArea(shapes[0])+k.surfaceArea(shapes[1]),8)
    for(const p of [...cageVertexLimits(a),...cageVertexLimits(b)]) expect(k.distanceToPoint(shapes[2],p)).toBeLessThan(1e-6)
  } finally { for(const shape of shapes) k.release(shape) }
},120000)
