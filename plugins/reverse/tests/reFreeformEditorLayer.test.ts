// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import type { SceneLayerHost } from '../../../src/viewer/sceneLayers'
import { type Cage, topology } from '../core/freeform/cage'
import { cageVertexLimits } from '../core/freeform/limit'
import { FreeformEditorLayer, type FreeformEditorOptions, type FreeformSelectionMode } from '../viewer/freeformEditorLayer'
import mergeFixtures from './fixtures/freeform-merge-reference.json'
import chainMerge from './fixtures/freeform-chain-merge-reference.json'
import surfaceDrags from './fixtures/freeform-surface-drag-reference.json'
import snappedDrags from './fixtures/freeform-snapped-point-reference.json'
import aligned from './fixtures/freeform-aligned-edge-reference.json'
import curvedContacts from './fixtures/freeform-curved-merge.json'
import { addRectangle } from '../core/freeform/edit'
import sideSeam from './fixtures/freeform-side-seam.json'

afterEach(() => vi.unstubAllGlobals())

it('snaps the visible shared surface point, rather than just its pole, on release', () => {
  const cage:Cage={positions:Float64Array.from([0,0,0, 5,0,0, 10,0,4, 0,5,0, 5,5,0, 10,5,4]),faces:[[0,1,4,3],[1,2,5,4]],creases:[]}
  const snapPoint=vi.fn((p:[number,number,number]):[number,number,number]=>[p[0],p[1],0])
  const s=setup({fitToScan:false,controlNet:false,mode:'points',neighbourRadius:2,snapPoint},cage)
  const a=cageVertexLimits(cage)[1]
  s.layer.pointerDown!(s.event('pointerdown',100+a[0]*10,100-a[1]*10))
  snapPoint.mockClear()
  s.canvas.dispatchEvent(s.event('pointermove',145,90))
  expect(snapPoint).not.toHaveBeenCalled()
  s.canvas.dispatchEvent(s.event('pointerup',145,90))
  expect(s.onCommit).toHaveBeenCalledOnce()
  const result=s.onCommit.mock.lastCall?.[0] as Cage
  expect(Math.abs(cageVertexLimits(result)[1][2])).toBeLessThan(1e-6)
  expect(result.faces).toEqual(cage.faces)
  expect(Array.from(cage.positions)).toEqual([0,0,0,5,0,0,10,0,4,0,5,0,5,5,0,10,5,4])
  s.editor.dispose()
})

it('keeps a nonplanar four-corner control surface independent of mesh snapping and late CAD', () => {
  const cage = {positions:Float64Array.of(0,0,0,5,0,0,5,5,2,0,5,0),faces:[[0,1,2,3]],creases:[]}
  const snapPoint=vi.fn((p: [number,number,number]) => [p[0],p[1],20] as [number,number,number])
  const measureLiveDeviation=vi.fn((p:Float32Array)=>Float32Array.from({length:p.length/3},(_,i)=>p[3*i+2]-20))
  const readDeviationMesh=vi.fn()
  const options={fitToScan:false,snapPoint,display:'deviation' as const,measureDeviation:async(p:Float32Array)=>measureLiveDeviation(p),measureLiveDeviation,readDeviationMesh}
  const s=setup(options,cage)
  const mesh=()=>s.partGroup.getObjectByName('freeform-deviation-surface') as THREE.Mesh
  const original=mesh().geometry.getAttribute('position').array.slice()
  const z=Array.from(original).filter((_,i)=>i%3===2)
  expect(Math.max(...z)).toBe(2)
  expect(z.some(v=>v>0&&v<2)).toBe(true)
  expect(snapPoint).not.toHaveBeenCalled()
  const finished=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([0,0,20,5,0,20,0,5,20],3))
  s.editor.set(cage,{...options,finishedSurface:finished})
  expect(mesh().geometry.getAttribute('position').array).toEqual(original)
  expect(readDeviationMesh).not.toHaveBeenCalled()
  expect(mesh().visible).toBe(true)
  s.editor.dispose();finished.dispose()
})

it('retains analysis GPU attributes across held geometry revisions and updates their measured values', () => {
  const measure=(p:Float32Array)=>Float32Array.from({length:p.length/3},(_,i)=>p[i*3]+p[i*3+2])
  const s=setup({fitToScan:false,display:'deviation',measureDeviation:async p=>measure(p),measureLiveDeviation:measure})
  const mesh=()=>s.partGroup.getObjectByName('freeform-deviation-surface') as THREE.Mesh
  const geometry=mesh().geometry,position=geometry.getAttribute('position'),values=geometry.getAttribute('signedDeviation')
  const before=values.array.slice(),disposed=vi.spyOn(geometry,'dispose')
  s.layer.pointerDown!(s.event('pointerdown',100,100))
  s.canvas.dispatchEvent(s.event('pointermove',90,110))
  expect(mesh().geometry).toBe(geometry)
  expect(mesh().geometry.getAttribute('position')).toBe(position)
  expect(mesh().geometry.getAttribute('signedDeviation')).toBe(values)
  expect(values.array).not.toEqual(before)
  expect(disposed).not.toHaveBeenCalled()
  s.win.dispatchEvent(Object.assign(new Event('keydown'),{key:'Escape'}))
  expect(values.array).toEqual(before)
  s.editor.dispose()
  expect(disposed).toHaveBeenCalledOnce()
})

it('retains overlay shader materials through held movement and releases them when the editor closes', () => {
  const s=setup({selection:[{kind:'edge',index:0}]})
  const names=['freeform-cage-outlines','freeform-selected-halo','freeform-selected-highlight']
  const materials=names.map(name=>(s.partGroup.getObjectByName(name) as THREE.Mesh).material as THREE.Material)
  const disposed=materials.map(m=>vi.spyOn(m,'dispose'))
  s.layer.pointerDown!(s.event('pointerdown',125,100))
  for(const x of [130,135,140]) {
    s.canvas.dispatchEvent(s.event('pointermove',x,110))
    names.forEach((name,i)=>expect((s.partGroup.getObjectByName(name) as THREE.Mesh).material).toBe(materials[i]))
  }
  disposed.forEach(spy=>expect(spy).not.toHaveBeenCalled())
  s.canvas.dispatchEvent(s.event('pointerup',140,110))
  s.editor.dispose()
  disposed.forEach(spy=>expect(spy).toHaveBeenCalledOnce())
})

it('measures dense large-cage charts once and accepts editing during CAD rebuild', () => {
  const cage = addRectangle({positions:new Float64Array(),faces:[],creases:[]}, [0,0,.02], [5,0,0], [0,5,0], 10, 10)
  const measure = vi.fn((p:Float32Array) => Float32Array.from({length:p.length/3},(_,i)=>p[i*3+2]))
  const range = vi.fn()
  const s = setup({display:'deviation',rebuilding:true,measureDeviation:async p=>measure(p),measureLiveDeviation:measure,onDeviation:range},cage)
  expect(measure.mock.calls[0][0].length/3).toBe(100 * 16 * 25)
  expect(range).toHaveBeenLastCalledWith(expect.objectContaining({preview:true,min:expect.closeTo(-.02),max:expect.closeTo(-.02)}))
  const before = measure.mock.calls.length
  s.layer.hover!({x:100,y:100},false)
  expect(measure.mock.calls.length).toBe(before)
  expect(s.layer.pointerDown!(s.event('pointerdown',100,100))).toBe(true)
  s.canvas.dispatchEvent(s.event('pointermove',90,110))
  s.canvas.dispatchEvent(s.event('pointerup',90,110))
  expect(s.onCommit).toHaveBeenCalledOnce()
  s.editor.dispose()
})

it('reallocates the color atlas after topology changes and keeps it through hover', async () => {
  const finished = () => new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([0,0,.02,5,0,.02,0,5,.02],3))
  const a=finished(), b=finished(), onDeviation=vi.fn()
  let faces=2
  const readDeviationMesh=vi.fn(async()=>({positions:a.getAttribute('position').array as Float32Array,indices:Uint32Array.of(0,1,2),
    analysisGrid:{coordinates:Float32Array.of(0,0,0,1,0,0,0,1,0),positions:new Float32Array(17*17*faces*3),size:17,faces}}))
  const measureDeviation=vi.fn(async(p:Float32Array)=>new Float32Array(p.length/3).fill(.02))
  const options={display:'deviation' as const,readDeviationMesh,measureDeviation,measureLiveDeviation:(p:Float32Array)=>new Float32Array(p.length/3),onDeviation}
  const s=setup({...options,finishedSurface:a})
  await vi.waitFor(()=>expect(onDeviation.mock.lastCall?.[0]?.preview).toBe(false))
  const mesh=()=>s.partGroup.getObjectByName('freeform-deviation-surface') as THREE.Mesh
  const material=mesh().material as THREE.Material, shader:any={vertexShader:'#include <begin_vertex>',fragmentShader:'#include <color_fragment>',uniforms:{}}
  material.onBeforeCompile(shader,{} as THREE.WebGLRenderer)
  const first=shader.uniforms.analysisGrid.value, disposed=vi.spyOn(first,'dispose'),version=material.version
  expect(first.image.height).toBe(34)
  s.layer.hover!({x:125,y:100},false)
  expect(material.version).toBe(version)
  expect(shader.uniforms.analysisGrid.value).toBe(first)
  s.editor.set(s.cage,{...options,finishedSurface:a,tolerance:.04})
  expect(readDeviationMesh).toHaveBeenCalledTimes(1)
  expect(measureDeviation).toHaveBeenCalledTimes(2)
  expect(shader.uniforms.analysisGrid.value.image.data[0]).toBeCloseTo(-.5)
  faces=4;onDeviation.mockClear();s.editor.set(s.cage,{...options,finishedSurface:b})
  await vi.waitFor(()=>expect(onDeviation.mock.lastCall?.[0]?.preview).toBe(false))
  expect(disposed).toHaveBeenCalledOnce()
  expect(shader.uniforms.analysisGrid.value).not.toBe(first)
  expect(shader.uniforms.analysisGrid.value.image.height).toBe(68)
  expect(shader.uniforms.analysisGridSize.value.y).toBe(1)
  expect(readDeviationMesh).toHaveBeenCalledTimes(2)
  s.editor.set(s.cage,{...options,finishedSurface:b,deviationReference:{}})
  await vi.waitFor(()=>expect(readDeviationMesh).toHaveBeenCalledTimes(3))
  s.editor.dispose();a.dispose();b.dispose()
})

it('captures both aligned edge endpoints, cancels atomically and commits one shared seam', () => {
  for (const cancel of [true, false]) {
    const cage: Cage = { positions: Float64Array.from(aligned.input.positions), faces: aligned.input.faces, creases: [] }
    const edge = topology(cage).edges.findIndex(e => e.a === 1 && e.b === 2)
    const s = setup({mode:'edges',controlNet:true,selection:[{kind:'edge',index:edge}]}, cage)
    s.layer.pointerDown!(s.event('pointerdown',80,110))
    s.canvas.dispatchEvent(s.event('pointermove',120,110))
    expect(s.onPreview.mock.lastCall?.[0].faces).toEqual(aligned.expected.faces)
    if (cancel) s.win.dispatchEvent(Object.assign(new Event('keydown'),{key:'Escape'}))
    s.canvas.dispatchEvent(s.event('pointerup',120,110))
    if (cancel) expect(s.onCommit).not.toHaveBeenCalled()
    else {
      expect(s.onCommit).toHaveBeenCalledTimes(1)
      const out = s.onCommit.mock.lastCall![0] as Cage
      expect(out.faces).toEqual(aligned.expected.faces)
      expect(Math.max(...out.positions.map((v,i)=>Math.abs(v-aligned.expected.positions[i])))).toBeLessThan(1e-6)
    }
    s.editor.dispose()
  }
})

it('keeps current preview visible during worker refinement and ignores an overtaken result', async () => {
  let resolve!: (data: any) => void
  const finished = new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([0,0,.02,5,0,.02,0,5,.02],3))
  const refine = vi.fn((data: any) => new Promise<any>(r => {resolve=()=>r(data)}))
  const onDeviation = vi.fn(), measure = (p:Float32Array)=>Float32Array.from({length:p.length/3},(_,i)=>p[i*3+2])
  const s=setup({display:'deviation',finishedSurface:finished,measureDeviation:async p=>measure(p),measureLiveDeviation:measure,refineDeviation:refine,onDeviation})
  await vi.waitFor(()=>expect(refine).toHaveBeenCalledTimes(1))
  expect(s.partGroup.getObjectByName('freeform-deviation-surface')?.visible).toBe(true)
  s.editor.set(s.cage,{display:'shaded'})
  onDeviation.mockClear();resolve(undefined)
  await new Promise(r=>setTimeout(r,0))
  expect(onDeviation).not.toHaveBeenCalled()
  s.editor.dispose();finished.dispose()
})

it('refines curved colors without changing CAD-sample statistics when tolerance changes', async () => {
  const finished = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-2,-1,2,2,-1,2,0,1,2],3))
  const measure = (p: Float32Array) => Float32Array.from({length:p.length/3}, (_,i)=>Math.hypot(p[i*3],p[i*3+2])-2)
  const measureDeviation = vi.fn(async (p: Float32Array) => measure(p)), onDeviation = vi.fn()
  const options = {display:'deviation' as const, finishedSurface:finished, measureDeviation, measureLiveDeviation:measure, onDeviation, tolerance:.01}
  const s = setup(options)
  await vi.waitFor(()=>expect(onDeviation.mock.lastCall?.[0]?.preview).toBe(false))
  const values = measure(measureDeviation.mock.calls[0][0]), range = onDeviation.mock.lastCall![0]
  expect(range.rms).toBeCloseTo(Math.sqrt(values.reduce((sum,v)=>sum+v*v,0)/values.length),10)
  const count = () => (s.partGroup.getObjectByName('freeform-deviation-surface') as THREE.Mesh).geometry.getAttribute('position').count
  const narrowCount = count(); expect(narrowCount).toBeGreaterThan(values.length)
  s.editor.set(s.cage,{...options,tolerance:.1})
  await vi.waitFor(()=>expect(measureDeviation).toHaveBeenCalledTimes(2))
  await vi.waitFor(()=>expect(onDeviation.mock.lastCall?.[0]?.preview).toBe(false))
  expect(onDeviation.mock.lastCall![0]).toEqual(range)
  expect(count()).not.toBe(narrowCount)
  s.editor.dispose(); finished.dispose()
})

it('keeps measured tolerance visible synchronously through hover and selection redraws', async () => {
  const finished = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0,0,.02,5,0,.02,0,5,.02],3))
  const measureDeviation = vi.fn(async (p: Float32Array) => new Float32Array(p.length / 3).fill(.02))
  const options = { display: 'deviation' as const, finishedSurface: finished, measureDeviation, mode: 'edges' as const }
  const s = setup(options)
  const visible = () => s.partGroup.getObjectByName('freeform-deviation-surface')?.visible
  await vi.waitFor(() => expect(visible()).toBe(true))
  const geometry = (s.partGroup.getObjectByName('freeform-deviation-surface') as THREE.Mesh).geometry
  const material = (s.partGroup.getObjectByName('freeform-deviation-surface') as THREE.Mesh).material as THREE.Material
  const materialDisposed = vi.spyOn(material, 'dispose'), version = material.version
  const disposed = vi.spyOn(geometry, 'dispose')
  for (let i = 0; i < 8; i++) {
    s.layer.hover!({x:125,y:100}, false)
    expect(visible()).toBe(true)
    expect((s.partGroup.getObjectByName('freeform-deviation-surface') as THREE.Mesh).geometry).toBe(geometry)
    expect(disposed).not.toHaveBeenCalled()
    expect((s.partGroup.getObjectByName('freeform-deviation-surface') as THREE.Mesh).material).toBe(material)
    expect(material.version).toBe(version)
    expect(materialDisposed).not.toHaveBeenCalled()
    s.layer.hover!(null, false)
    expect(visible()).toBe(true)
  }
  s.editor.set(s.cage, {...options, selection:[{kind:'edge',index:0}], tolerance:.1})
  expect(visible()).toBe(true)
  expect(disposed).not.toHaveBeenCalled()
  expect(measureDeviation).toHaveBeenCalledTimes(1)
  s.editor.dispose(); finished.dispose()
  expect(disposed).toHaveBeenCalledTimes(1)
  expect(materialDisposed).toHaveBeenCalledTimes(1)
})

it('paints current measured preview while finished CAD sampling is pending', async () => {
  let resolve!: (values: Float32Array) => void
  const finished = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0,0,.02,5,0,.02,0,5,.02],3))
  const readDeviationMesh = vi.fn(async () => ({positions: finished.getAttribute('position').array as Float32Array, indices:Uint32Array.of(0,1,2)}))
  const measureDeviation = vi.fn(() => new Promise<Float32Array>(r => {resolve = r}))
  const measureLiveDeviation = vi.fn((p: Float32Array) => Float32Array.from({length:p.length/3}, (_,i)=>p[3*i+2]))
  const onDeviation = vi.fn()
  const s = setup({ display:'deviation', finishedSurface:finished, readDeviationMesh, measureDeviation, measureLiveDeviation, onDeviation })
  expect(s.partGroup.getObjectByName('freeform-deviation-surface')?.visible).toBe(true)
  expect(onDeviation).toHaveBeenLastCalledWith({min:0,max:0,rms:0,preview:true})
  await vi.waitFor(() => expect(measureDeviation).toHaveBeenCalledTimes(1))
  resolve(new Float32Array(7).fill(.02))
  await vi.waitFor(() => expect(onDeviation).toHaveBeenLastCalledWith(expect.objectContaining({preview:false,max:expect.closeTo(-.02)})))
  s.editor.dispose(); finished.dispose()
})

it('reallocates normals when finished analysis has more samples than its preview', async () => {
  const positions = Float32Array.from({length:18000}, (_,k) => {
    const v=Math.floor(k/3),t=Math.floor(v/3)
    return k%3===2 ? .02 : k%3===0 ? t%40+(v%3===1?1:0) : Math.floor(t/40)+(v%3===2?1:0)
  })
  const finished = new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(positions,3))
  const s = setup({display:'deviation',finishedSurface:finished,
    measureLiveDeviation:p=>new Float32Array(p.length/3),
    measureDeviation:async p=>new Float32Array(p.length/3).fill(.02)})
  const initial = (s.partGroup.getObjectByName('freeform-deviation-surface') as THREE.Mesh).geometry.getAttribute('position').count
  await vi.waitFor(()=>expect((s.partGroup.getObjectByName('freeform-deviation-surface') as THREE.Mesh).geometry.getAttribute('position').count).toBeGreaterThan(initial))
  const g=(s.partGroup.getObjectByName('freeform-deviation-surface') as THREE.Mesh).geometry
  expect(g.getAttribute('normal').count).toBe(g.getAttribute('position').count)
  s.editor.dispose();finished.dispose()
})

it('previews a native point merge and commits the welded selection only on release', () => {
  const f = mergeFixtures[0], cage: Cage = { positions: Float64Array.from(f.input.positions), faces: f.input.faces, creases: [] }
  const s = setup({ mode: 'points', controlNet: true }, cage)
  const xy = (v: number) => [100 + cage.positions[v * 3] * 10, 100 - cage.positions[v * 3 + 1] * 10]
  const [x, y] = xy(f.from), [tx, ty] = xy(f.to)
  s.layer.pointerDown!(s.event('pointerdown', x, y))
  s.canvas.dispatchEvent(s.event('pointermove', tx - 4, ty))
  expect(s.onCommit).not.toHaveBeenCalled()
  expect(s.onPreview.mock.lastCall?.[0].positions.length).toBe(33)
  s.canvas.dispatchEvent(s.event('pointerup', tx - 4, ty))
  expect(s.onCommit).toHaveBeenCalledTimes(1)
  expect(s.onCommit.mock.lastCall?.[0].faces).toEqual(f.expected.faces)
  expect(s.onCommit.mock.lastCall?.[1]).toEqual([{ kind: 'vertex', index: 9 }])
  expect(Array.from(cage.positions)).toEqual(f.input.positions)
  s.editor.dispose()
})

it('leaves a miss beyond the 11-pixel capture band unwelded and cancels a captured point merge atomically', () => {
  for (const cancel of [false, true]) {
    const f = mergeFixtures[0], cage: Cage = { positions: Float64Array.from(f.input.positions), faces: f.input.faces, creases: [] }
    const s = setup({ mode: 'points', controlNet: true }, cage)
    const x = 100 + cage.positions[f.from * 3] * 10, y = 100 - cage.positions[f.from * 3 + 1] * 10
    const tx = 100 + cage.positions[f.to * 3] * 10
    s.layer.pointerDown!(s.event('pointerdown', x, y))
    s.canvas.dispatchEvent(s.event('pointermove', tx - (cancel ? 0 : 12), y))
    if (cancel) s.win.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }))
    s.canvas.dispatchEvent(s.event('pointerup', tx - (cancel ? 0 : 12), y))
    if (cancel) { expect(s.onCommit).not.toHaveBeenCalled(); expect(s.onPreview.mock.lastCall).toEqual([cage, false]) }
    else expect(s.onCommit.mock.lastCall?.[0].positions.length).toBe(36)
    s.editor.dispose()
  }
})

it('welds a point dropped 10 px from its target, inside QUICKSURFACE\'s 11-pixel capture band', () => {
  const f = mergeFixtures[0], cage: Cage = { positions: Float64Array.from(f.input.positions), faces: f.input.faces, creases: [] }
  const s = setup({ mode: 'points', controlNet: true }, cage)
  const x = 100 + cage.positions[f.from * 3] * 10, y = 100 - cage.positions[f.from * 3 + 1] * 10
  const tx = 100 + cage.positions[f.to * 3] * 10, ty = 100 - cage.positions[f.to * 3 + 1] * 10
  s.layer.pointerDown!(s.event('pointerdown', x, y))
  s.canvas.dispatchEvent(s.event('pointermove', tx - 10, ty))
  s.canvas.dispatchEvent(s.event('pointerup', tx - 10, ty))
  expect(s.onCommit).toHaveBeenCalledOnce()
  expect(s.onCommit.mock.lastCall?.[0].positions.length).toBe(cage.positions.length - 3)
  s.editor.dispose()
})

it('moves a corner near another corner of its own quad instead of refusing it', () => {
  const s = setup({ mode: 'points', controlNet: true })
  // The quad's corner at (0, 0) dragged to 8 px from its corner at (5, 0).
  s.layer.pointerDown!(s.event('pointerdown', 100, 100))
  s.canvas.dispatchEvent(s.event('pointermove', 142, 100))
  s.canvas.dispatchEvent(s.event('pointerup', 142, 100))
  expect(s.onCommit).toHaveBeenCalledOnce()
  expect(s.onCommit.mock.lastCall?.[0].positions.length).toBe(12)
  s.editor.dispose()
})

it('refuses same-face point contact instead of committing a collapsed quad', () => {
  const s = setup({ mode: 'points', controlNet: true })
  s.layer.pointerDown!(s.event('pointerdown', 100, 100))
  s.canvas.dispatchEvent(s.event('pointermove', 150, 100))
  s.canvas.dispatchEvent(s.event('pointerup', 150, 100))
  expect(s.onCommit).not.toHaveBeenCalled()
  expect(s.onPreview.mock.lastCall).toEqual([s.cage, false])
  s.editor.dispose()
})

it('axis handles constrain translation and preserve unselected vertices', () => {
  const s = setup({ selection: [{kind:'vertex', index:0}], manipulator:'world' })
  expect(s.layer.pointerDown!(s.event('pointerdown',157,100))).toBe(true)
  s.canvas.dispatchEvent(s.event('pointerup',177,120))
  const result = s.onCommit.mock.calls[0][0] as Cage
  expect(result.positions[0]).toBeCloseTo(2); expect(Array.from(result.positions.slice(1,3))).toEqual([0,0])
  expect(Array.from(result.positions.slice(3))).toEqual(Array.from(s.cage.positions.slice(3)))
  s.editor.dispose()
})
it('Boundary selection excludes a shared internal edge', () => {
  const input: Cage = {positions:Float64Array.from([0,0,0, 5,0,0, 5,5,0, 0,5,0, 10,0,0, 10,5,0]),faces:[[0,1,2,3],[1,4,5,2]],creases:[]}
  const s = setup({mode:'boundary'},input)
  s.canvas.dispatchEvent(s.event('contextmenu',150,75))
  expect(s.onContext.mock.lastCall?.[2]).toBeNull()
  s.canvas.dispatchEvent(s.event('contextmenu',125,100))
  expect(s.onContext.mock.lastCall?.[2]?.kind).toBe('edge')
  expect(s.onCommit).not.toHaveBeenCalled(); s.editor.dispose()
})
it('refreshes boundary picking after replacing the cage topology', () => {
  const s = setup({mode:'boundary'})
  s.canvas.dispatchEvent(s.event('contextmenu',150,75))
  expect(s.onContext.mock.lastCall?.[2]?.kind).toBe('edge')
  const extended:Cage={positions:Float64Array.from([0,0,0,5,0,0,5,5,0,0,5,0,10,0,0,10,5,0]),faces:[[0,1,2,3],[1,4,5,2]],creases:[]}
  s.editor.set(extended,{mode:'boundary',onContext:s.onContext})
  for(let i=0;i<10;i++)s.layer.tick!(200,200)
  s.canvas.dispatchEvent(s.event('contextmenu',150,75))
  expect(s.onContext.mock.lastCall?.[2]).toBeNull()
  s.canvas.dispatchEvent(s.event('contextmenu',200,75))
  expect(s.onContext.mock.lastCall?.[2]?.kind).toBe('edge')
  s.editor.dispose()
})
it('world and local manipulator frames respect the part rotation', () => {
  for (const frame of ['world','local'] as const) {
    const s = setup({selection:[{kind:'vertex',index:0}],manipulator:frame})
    s.partGroup.rotation.z = Math.PI/2; s.layer.tick!(200,200)
    const x = frame==='world'?157:100, y=frame==='world'?100:43
    s.layer.pointerDown!(s.event('pointerdown',x,y))
    s.canvas.dispatchEvent(s.event('pointerup',x+20,y-20))
    const result = s.onCommit.mock.calls[0][0] as Cage
    expect(result.positions[0]).toBeCloseTo(frame==='world'?0:2)
    expect(result.positions[1]).toBeCloseTo(frame==='world'?-2:0)
    s.editor.dispose()
  }
})
it('view-facing rotation ring rotates a selected face around its centre', () => {
  const s = setup({selection:[{kind:'face',index:0}],manipulator:'world'})
  s.layer.pointerDown!(s.event('pointerdown',125+48/Math.sqrt(2),75-48/Math.sqrt(2)))
  s.canvas.dispatchEvent(s.event('pointerup',125,27))
  const result = s.onCommit.mock.calls[0][0] as Cage
  expect(result.positions[0]).toBeCloseTo(2.5)
  expect(result.positions[1]).toBeCloseTo(2.5-5/Math.sqrt(2))
  expect(result.faces).toEqual(s.cage.faces)
  s.editor.dispose()
})
it('scale handles scale only their axis and Escape cancels a subsequent handle drag', () => {
  const s = setup({selection:[{kind:'face',index:0}],manipulator:'world'})
  s.layer.pointerDown!(s.event('pointerdown',219,75))
  s.canvas.dispatchEvent(s.event('pointerup',313,75))
  const result = s.onCommit.mock.calls[0][0] as Cage
  expect(result.positions[0]).toBeCloseTo(-2.5); expect(result.positions[3]).toBeCloseTo(7.5)
  expect(result.positions[1]).toBe(0); expect(result.positions[7]).toBe(5)
  s.layer.pointerDown!(s.event('pointerdown',182,75)); s.canvas.dispatchEvent(s.event('pointermove',192,75))
  s.win.dispatchEvent(Object.assign(new Event('keydown'),{key:'Escape'}))
  s.canvas.dispatchEvent(s.event('pointerup',192,75))
  expect(s.onCommit).toHaveBeenCalledTimes(1)
  s.editor.dispose()
})
function setup(options: FreeformEditorOptions = {}, input?: Cage) {
  const win = new EventTarget(); vi.stubGlobal('window', win)
  const canvas = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }), setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() })
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100)
  camera.position.z = 20; camera.updateMatrixWorld()
  const partGroup = new THREE.Group(), raycaster = new THREE.Raycaster()
  const host = { canvas, camera: () => camera, partGroup, raycaster, modelRadius: () => 10,
    setPickRay: (x: number, y: number) => raycaster.setFromCamera(new THREE.Vector2(x / 100 - 1, 1 - y / 100), camera),
    claimDrag: vi.fn(), setCursor: vi.fn(), invalidate: vi.fn(), pickScan: vi.fn(() => ({ point: [1, 2, 3] })),
  } as unknown as SceneLayerHost
  const cage: Cage = input ?? { positions: Float64Array.from([0, 0, 0, 5, 0, 0, 5, 5, 0, 0, 5, 0]), faces: [[0, 1, 2, 3]], creases: [] }
  const onCommit = vi.fn(), onSelection = vi.fn(), onPreview = vi.fn(), onContext = vi.fn()
  const editor = new FreeformEditorLayer(host)
  editor.set(cage, { onCommit, onSelection, onPreview, onContext, ...options })
  const event = (type: string, x = 100, y = 100, extra = {}) => Object.assign(new Event(type), { pointerId: 1, button: 0, clientX: x, clientY: y, ...extra }) as PointerEvent
  return { editor, layer: editor.layer(), cage, host, canvas, win, event, onCommit, onSelection, onPreview, onContext, partGroup }
}

// Same faceted radius-20 scan as the independently saved native contact cases.
const contactSection = Array.from({ length: 21 }, (_, i) => [i - 10, Math.fround(20 - Math.sqrt(400 - (i - 10) ** 2))])
const contactClosest = (p: [number, number, number]): [number, number, number] => {
  let best = Infinity, point = p
  for (let i = 0; i + 1 < contactSection.length; i++) {
    const [a,z] = contactSection[i], [b,w] = contactSection[i+1], dx=b-a, dz=w-z
    const t=Math.max(0,Math.min(1,((p[0]-a)*dx+(p[2]-z)*dz)/(dx*dx+dz*dz)))
    const x=a+t*dx, h=z+t*dz, distance=(x-p[0])**2+(h-p[2])**2
    if(distance<best){best=distance;point=[x,p[1],h]}
  }
  return point
}
const contactRayHeight = (x: number) => {
  const i=Math.floor(x)+10, a=contactSection[i], b=contactSection[i+1]
  return a[1]+(x-a[0])*(b[1]-a[1])
}

it.each(['release','leave','cancel'])('retains the raw curved contact at high zoom through %s', action => {
  const cage:Cage={...curvedContacts.before,positions:Float64Array.from(curvedContacts.before.positions),creases:[]}
  const selection=topology(cage).edges.flatMap((e,index)=>[`${e.a}:${e.b}`,`${e.b}:${e.a}`].some(k=>['2:8','3:8'].includes(k))?[{kind:'edge' as const,index}]:[])
  const s=setup({mode:'edges',selection,controlNet:true,snapPoint:contactClosest},cage)
  const scale=125/3.93162381649, camera=s.host.camera() as THREE.OrthographicCamera
  camera.zoom=scale/10;camera.updateProjectionMatrix()
  const source=cage.positions[9], y=100-(cage.positions[10]+cage.positions[25])/2*scale
  const x=100+source*scale, end=x+3.774358868598938*scale
  // The raw endpoint is 4.99999985 px away; projecting first moves it to 5.2195 px.
  expect((cage.positions[12]-source-3.774358868598938)*scale).toBeLessThan(5)
  expect((cage.positions[12]-contactClosest([source+3.774358868598938,cage.positions[10],cage.positions[11]])[0])*scale).toBeGreaterThan(5)
  s.layer.pointerDown!(s.event('pointerdown',x,y));s.canvas.dispatchEvent(s.event('pointermove',end,y))
  expect(s.onPreview.mock.lastCall?.[0].positions).toHaveLength(33)
  expect(s.onCommit).not.toHaveBeenCalled()
  // Leaving: about 13 px from the target, outside the 11-pixel capture band.
  if(action==='leave')s.canvas.dispatchEvent(s.event('pointermove',end-8,y))
  if(action==='cancel')s.win.dispatchEvent(Object.assign(new Event('keydown'),{key:'Escape'}))
  s.canvas.dispatchEvent(s.event('pointerup',action==='leave'?end-8:end,y))
  if(action==='cancel')expect(s.onCommit).not.toHaveBeenCalled()
  else {
    expect(s.onCommit).toHaveBeenCalledOnce()
    const result=s.onCommit.mock.lastCall?.[0] as Cage
    expect(result.positions).toHaveLength(action==='leave'?36:33)
    if(action==='release'){
      expect(result.faces).toEqual(curvedContacts.after['curved-chain-on'].faces)
      expect(Math.max(...result.positions.map((v,i)=>Math.abs(v-curvedContacts.after['curved-chain-on'].positions[i])))).toBeLessThan(5e-7)
    }
  }
  s.editor.dispose()
})

it.each([false,true])('joins the native Ray Projection evaluated point with unchanged other poles (cancel=%s)', cancel => {
  // Fresh 1.1.89 native Ray/OFF save is bit-identical to the retained Closest/OFF result.
  const cage:Cage={...curvedContacts.before,positions:Float64Array.from(curvedContacts.before.positions),creases:[]}
  const s=setup({mode:'points',controlNet:false,snapPoint:contactClosest,
    rayPoint:p=>[p[0],p[1],contactRayHeight(p[0])]},cage)
  const anchors=cageVertexLimits(cage),xy=(p:number[])=>[100+p[0]*10,100-p[1]*10],a=xy(anchors[8]),b=xy(anchors[10])
  vi.mocked(s.host.pickScan).mockImplementation((x,y)=>({point:[(x-100)/10,(100-y)/10,contactRayHeight((x-100)/10)]} as ReturnType<SceneLayerHost['pickScan']>))
  s.layer.pointerDown!(s.event('pointerdown',a[0],a[1]));s.canvas.dispatchEvent(s.event('pointermove',b[0],b[1]))
  expect(s.onPreview.mock.lastCall?.[0].positions).toHaveLength(33)
  expect(s.onCommit).not.toHaveBeenCalled()
  if(cancel)s.win.dispatchEvent(Object.assign(new Event('keydown'),{key:'Escape'}))
  s.canvas.dispatchEvent(s.event('pointerup',b[0],b[1]))
  if(cancel)expect(s.onCommit).not.toHaveBeenCalled()
  else {
    expect(s.onCommit).toHaveBeenCalledOnce()
    const result=s.onCommit.mock.lastCall?.[0] as Cage,expected=curvedContacts.after['curved-point-off']
    expect(result.faces).toEqual(expected.faces)
    expect(Math.max(...result.positions.map((v,i)=>Math.abs(v-expected.positions[i])))).toBeLessThan(5e-7)
    expect(s.onCommit.mock.lastCall?.[1]).toEqual([{kind:'vertex',index:9}])
  }
  expect(Array.from(cage.positions)).toEqual(curvedContacts.before.positions)
  s.editor.dispose()
})
it.each([false,true])('welds a seam point pulled out and dropped on a partner under 2 px from where it was grabbed (Control Net %s)', controlNet => {
  // QUICKSURFACE 2026-11-17: after a whole-side contact welds one end, the
  // other seam points sit about 2 px from their partners; each is pulled out
  // and dropped back on its partner. The drop ended under 2 px from the grab,
  // which counted as "not moved" and threw the weld away.
  const held=sideSeam.sideHeld,cage:Cage={positions:Float64Array.from(held.positions),faces:held.faces.map(f=>[...f]),creases:[]}
  const s=setup({mode:'points',controlNet,snapPoint:p=>[p[0],p[1],0]},cage)
  vi.mocked(s.host.pickScan).mockImplementation((x,y)=>({point:[(x-100)/10,(100-y)/10,0]} as ReturnType<SceneLayerHost['pickScan']>))
  const shown=controlNet?Array.from({length:cage.positions.length/3},(_,i)=>Array.from(cage.positions.slice(3*i,3*i+3))):cageVertexLimits(cage)
  // Under 0.5 px apart the pick may take either pole of the pair; either
  // drop is a weld. The exact native poles are paired in reFreeformSideSeam.
  const xy=(p:number[])=>[100+p[0]*10,100-p[1]*10],a=xy(shown[9]),b=xy(shown[7])
  expect(Math.hypot(a[0]-b[0],a[1]-b[1])).toBeLessThan(2)
  s.layer.pointerDown!(s.event('pointerdown',a[0],a[1]))
  s.canvas.dispatchEvent(s.event('pointermove',b[0]+30,b[1]))
  s.canvas.dispatchEvent(s.event('pointermove',b[0],b[1]))
  s.canvas.dispatchEvent(s.event('pointerup',b[0],b[1]))
  expect(s.onCommit).toHaveBeenCalledOnce()
  const result=s.onCommit.mock.lastCall?.[0] as Cage
  expect(result.positions).toHaveLength(30)
  // The seam's upper edge is now shared by both strips, as in QUICKSURFACE.
  const shared=(c:Cage)=>topology(c).edges.filter(e=>e.faces.length===2).length
  expect(shared(result)).toBe(shared({...sideSeam.middleWelded,positions:Float64Array.from(sideSeam.middleWelded.positions),creases:[]}))
  s.editor.dispose()
})
it('reports finished CAD measurements and switches to live preview during a drag', async () => {
  const finished = new THREE.BufferGeometry().setAttribute(
    'position', new THREE.Float32BufferAttribute([0, 0, -2, 5, 0, 2, 0, 5, 4], 3),
  )
  const measureDeviation = vi.fn(async (positions: Float32Array) => positions.filter((_, i) => i % 3 === 2))
  const onDeviation = vi.fn()
  const cadRange = { min: -4, max: 2, rms: Math.sqrt((34 + Math.fround(4 / 3) ** 2) / 7), preview: false }
  const readDeviationMesh = vi.fn(async () => ({
    positions: new Float32Array([0, 0, -2, 5, 0, 2, 0, 5, 4]),
    indices: new Uint32Array([0, 1, 2]),
  }))
  const s = setup({ display: 'deviation', finishedSurface: finished, readDeviationMesh, measureDeviation, onDeviation })
  await vi.waitFor(() => expect(onDeviation).toHaveBeenLastCalledWith(cadRange))
  expect(measureDeviation.mock.calls[0][0]).toHaveLength(21)
  expect(s.layer.pointerDown!(s.event('pointerdown'))).toBe(true)
  s.canvas.dispatchEvent(s.event('pointermove', 120))
  await vi.waitFor(() => expect(onDeviation).toHaveBeenLastCalledWith({ min: 0, max: 0, rms: 0, preview: true }))
  expect(s.onCommit).not.toHaveBeenCalled()
  s.win.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }))
  await vi.waitFor(() => expect(onDeviation).toHaveBeenLastCalledWith(cadRange))
  expect(readDeviationMesh).toHaveBeenCalledTimes(1)
  s.editor.dispose()
  finished.dispose()
})
it('shows quad outlines in a live Solid drag and removes them after cancel', () => {
  const s = setup({ display: 'shaded', showEdges: false, controlNet: false })
  const lines = () => s.partGroup.getObjectByName('freeform-cage-outlines') as THREE.LineSegments
  expect(lines().geometry.getAttribute('position').count).toBe(0)
  expect(s.layer.pointerDown!(s.event('pointerdown'))).toBe(true)
  s.canvas.dispatchEvent(s.event('pointermove', 120))
  expect(lines().geometry.getAttribute('position').count).toBeGreaterThan(8)
  expect(lines().material).toMatchObject({ depthTest: true, depthWrite: false })
  s.win.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }))
  expect(lines().geometry.getAttribute('position').count).toBe(0)
  s.editor.dispose()
})

it.each([NaN, Infinity, -Infinity])('does not report a passing surface when one measured sample is %s', async missing => {
  const measureDeviation = vi.fn(async (positions: Float32Array) => {
    const values = new Float32Array(positions.length / 3)
    values[0] = missing
    return values
  })
  const onDeviation = vi.fn(), onDeviationError = vi.fn()
  const s = setup({ display: 'deviation', measureDeviation, onDeviation, onDeviationError })
  await vi.waitFor(() => expect(onDeviationError).toHaveBeenCalled())
  expect(onDeviation.mock.calls.every(([value]) => value === null)).toBe(true)
  expect(s.partGroup.getObjectByName('freeform-deviation-surface')?.visible).toBe(false)
  s.editor.dispose()
})

it('reuses physical measurements across thresholds but invalidates them when the scan changes', async () => {
  const finished = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0,0,0,5,0,0,0,5,0],3))
  const measureDeviation = vi.fn(async (positions: Float32Array) => new Float32Array(positions.length / 3).fill(.02))
  const onDeviation = vi.fn()
  const options = { display: 'deviation' as const, finishedSurface: finished, measureDeviation, onDeviation, tolerance: .01, deviationReference: {} }
  const s = setup(options)
  await vi.waitFor(() => expect(onDeviation).toHaveBeenCalledWith(expect.objectContaining({ max: expect.closeTo(-.02) })))
  const range = onDeviation.mock.lastCall?.[0]
  s.editor.set(s.cage, { ...options, tolerance: .1, colouring: 'pass-fail' })
  await vi.waitFor(() => expect((s.partGroup.getObjectByName('freeform-deviation-surface') as THREE.Mesh).visible).toBe(true))
  const mesh = s.partGroup.getObjectByName('freeform-deviation-surface') as THREE.Mesh
  expect(mesh.geometry.getAttribute('signedDeviation').getX(0)).toBeCloseTo(-.2)
  expect(onDeviation.mock.lastCall?.[0]).toEqual(range)
  expect(measureDeviation).toHaveBeenCalledTimes(1)
  measureDeviation.mockImplementation(async positions => new Float32Array(positions.length / 3).fill(.03))
  s.editor.set(s.cage, { ...options, deviationReference: {} })
  await vi.waitFor(() => expect(onDeviation).toHaveBeenLastCalledWith(expect.objectContaining({ max: expect.closeTo(-.03) })))
  expect(measureDeviation).toHaveBeenCalledTimes(2)
  s.editor.dispose(); finished.dispose()
})
it('draws Zebra and Shaded on finished CAD without disposing the body geometry when the mode changes', () => {
  const finished = new THREE.BufferGeometry()
    .setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 5, 0, 0, 0, 5, 0], 3))
  finished.computeVertexNormals()
  const dispose = vi.spyOn(finished, 'dispose')
  const s = setup({ display: 'zebra', finishedSurface: finished })
  const usesFinishedGeometry = () => {
    let found = false
    s.partGroup.traverse(object => { if (object instanceof THREE.Mesh && object.geometry === finished) found = true })
    return found
  }
  expect(usesFinishedGeometry()).toBe(true)
  s.editor.set(s.cage, { display: 'shaded', finishedSurface: finished })
  expect(usesFinishedGeometry()).toBe(true)
  s.editor.dispose()
  expect(dispose).not.toHaveBeenCalled()
  finished.dispose()
})
it('separates surface opacity, cage edges and Control Net', () => {
  const finishedSurface = new THREE.BufferGeometry()
    .setAttribute('position', new THREE.Float32BufferAttribute([0, 0, .1, 5, 0, .1, 0, 5, .1, 5, 5, .1], 3))
    .setIndex([0, 1, 2, 1, 3, 2])
  finishedSurface.computeVertexNormals()
  const options = { display: 'shaded', finishedSurface, controlNet: false } as const
  const s = setup({ ...options, showEdges: false })
  const material = () => (s.partGroup.getObjectByName('freeform-finished-cad') as THREE.Mesh).material
  const linePositions = () => (s.partGroup.getObjectByName('freeform-cage-outlines') as THREE.LineSegments).geometry.getAttribute('position')
  expect(material()).toMatchObject({ opacity: 1, transparent: false, depthWrite: true })
  expect(linePositions().count).toBe(0)
  s.editor.set(s.cage, { ...options, showEdges: true })
  expect(linePositions().count).toBeGreaterThan(0)
  expect(linePositions().array.filter((_, index) => index % 3 === 2).every(z => Math.abs(z - .1) < 1e-6)).toBe(true)
  s.editor.set(s.cage, { ...options, showEdges: false, opacity: .4, controlNet: true })
  expect(material()).toMatchObject({ opacity: .4, transparent: true, depthWrite: false })
  expect(linePositions().count).toBe(8)
  expect(linePositions().array.filter((_, index) => index % 3 === 2).every(z => z === 0)).toBe(true)
  s.editor.dispose()
  finishedSurface.dispose()
})
it('moves a picked vertex on release only and preserves the source cage', () => {
  const s = setup()
  expect(s.layer.pointerDown!(s.event('pointerdown'))).toBe(true)
  s.canvas.dispatchEvent(s.event('pointermove', 120))
  expect(s.onCommit).not.toHaveBeenCalled()
  s.canvas.dispatchEvent(s.event('pointerup', 120))
  expect(s.onCommit).toHaveBeenCalledTimes(1)
  expect(s.onCommit.mock.calls[0][0].positions[0]).toBeCloseTo(2)
  expect(s.cage.positions[0]).toBe(0)
  s.editor.dispose()
})
it('cancels Escape and pointercancel without a history commit', () => {
  for (const escape of [true, false]) {
    const s = setup()
    s.layer.pointerDown!(s.event('pointerdown')); s.canvas.dispatchEvent(s.event('pointermove', 130))
    if (escape) s.win.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }))
    else s.canvas.dispatchEvent(s.event('pointercancel', 130))
    s.canvas.dispatchEvent(s.event('pointerup', 130))
    expect(s.onCommit).not.toHaveBeenCalled()
    expect(s.onPreview.mock.lastCall).toEqual([s.cage, false])
    s.editor.dispose()
  }
})
it('does not commit clicks or out-and-back gestures', () => {
  const s = setup()
  s.layer.pointerDown!(s.event('pointerdown')); s.canvas.dispatchEvent(s.event('pointerup'))
  s.layer.pointerDown!(s.event('pointerdown')); s.canvas.dispatchEvent(s.event('pointermove', 120)); s.canvas.dispatchEvent(s.event('pointerup'))
  expect(s.onCommit).not.toHaveBeenCalled(); s.editor.dispose()
})
it('pulls a snapped duplicate off the scan while held and projects only on release', () => {
  const snapPoint = vi.fn((p: [number,number,number]): [number,number,number] => [p[0],p[1],0])
  const options: FreeformEditorOptions = {selection:[{kind:'edge',index:0}],duplicateHandle:true,snapPoint,
    display:'deviation',measureDeviation:async p=>new Float32Array(p.length/3),
    measureLiveDeviation:p=>Float32Array.from({length:p.length/3},(_,i)=>p[3*i+2])}
  const s=setup(options),camera=s.host.camera()
  camera.position.set(0,-20,20);camera.up.set(0,0,1);camera.lookAt(0,0,0);camera.updateMatrixWorld()
  s.editor.set(s.cage,{...options,onCommit:s.onCommit,onPreview:s.onPreview})
  const at=(s.editor as any).duplicateAnchor().at
  s.layer.pointerDown!(s.event('pointerdown',at.x,at.y));snapPoint.mockClear()
  s.canvas.dispatchEvent(s.event('pointermove',at.x,at.y+30))
  const draft=s.onPreview.mock.lastCall?.[0] as Cage
  expect(draft.faces).toHaveLength(2)
  expect(Math.abs(draft.positions[14])).toBeGreaterThan(1)
  expect(snapPoint).not.toHaveBeenCalled()
  const analysis=s.partGroup.getObjectByName('freeform-deviation-surface') as THREE.Mesh
  expect(analysis.visible).toBe(true)
  expect([...analysis.geometry.getAttribute('signedDeviation').array].some(v=>Math.abs(v)>1)).toBe(true)
  s.canvas.dispatchEvent(s.event('pointerup',at.x,at.y+30))
  expect(s.onCommit).toHaveBeenCalledTimes(1)
  const result=s.onCommit.mock.lastCall?.[0] as Cage
  expect(result.faces).toHaveLength(2)
  expect([...result.positions].filter((_,i)=>i%3===2).every(z=>z===0)).toBe(true)
  expect(Array.from(result.positions.slice(0,12))).toEqual(Array.from(s.cage.positions))
  s.editor.dispose()
})

it('lets a Closest Point vertex follow the drag plane without scan queries while held', () => {
  const snapPoint=vi.fn((p:[number,number,number]):[number,number,number]=>[p[0],p[1],0])
  const s=setup({snapPoint,controlNet:true,mode:'points'})
  const camera=s.host.camera();camera.position.set(0,-20,20);camera.up.set(0,0,1);camera.lookAt(0,0,0);camera.updateMatrixWorld()
  s.layer.pointerDown!(s.event('pointerdown'));snapPoint.mockClear()
  s.canvas.dispatchEvent(s.event('pointermove',100,130))
  expect(Math.abs(s.onPreview.mock.lastCall?.[0].positions[2])).toBeGreaterThan(1)
  expect(snapPoint).not.toHaveBeenCalled()
  s.win.dispatchEvent(Object.assign(new Event('keydown'),{key:'Escape'}))
  expect(s.onCommit).not.toHaveBeenCalled();expect(s.onPreview.mock.lastCall).toEqual([s.cage,false]);s.editor.dispose()
})

it('retains moving geometry and measured colors through a selection option refresh', () => {
  const options: FreeformEditorOptions={display:'deviation',measureDeviation:async p=>new Float32Array(p.length/3),
    measureLiveDeviation:p=>Float32Array.from({length:p.length/3},(_,i)=>p[3*i])}
  const s=setup(options)
  s.layer.pointerDown!(s.event('pointerdown'));s.canvas.dispatchEvent(s.event('pointermove',120))
  const geometry=()=>((s.partGroup.getObjectByName('freeform-deviation-surface') as THREE.Mesh).geometry.getAttribute('position').array)
  const moving=Array.from(geometry())
  s.editor.set(s.cage,{...options,selection:[{kind:'vertex',index:0}],onCommit:s.onCommit,onPreview:s.onPreview})
  expect(Array.from(geometry())).toEqual(moving)
  expect(s.partGroup.getObjectByName('freeform-deviation-surface')?.visible).toBe(true)
  s.canvas.dispatchEvent(s.event('pointerup',120))
  expect(s.onCommit).toHaveBeenCalledTimes(1)
  expect(s.onCommit.mock.lastCall?.[0].positions[0]).toBeCloseTo(2)
  s.editor.dispose()
})

it('snaps a lifted vertex on release outside the scan silhouette', () => {
  const snapPoint=vi.fn((p:[number,number,number]):[number,number,number]=>[p[0],p[1],0])
  const s=setup({snapPoint,controlNet:true,mode:'points'})
  const camera=s.host.camera();camera.position.set(0,-20,20);camera.up.set(0,0,1);camera.lookAt(0,0,0);camera.updateMatrixWorld()
  s.layer.pointerDown!(s.event('pointerdown'))
  s.host.pickScan=()=>null
  s.canvas.dispatchEvent(s.event('pointermove',100,130))
  expect(Math.abs(s.onPreview.mock.lastCall?.[0].positions[2])).toBeGreaterThan(1)
  s.canvas.dispatchEvent(s.event('pointerup',100,130))
  expect(s.onCommit).toHaveBeenCalledTimes(1)
  expect(s.onCommit.mock.lastCall?.[0].positions[2]).toBe(0)
  expect(snapPoint).toHaveBeenCalled();s.editor.dispose()
})

it('moves an edge normally and extends only the enabled duplicate handle', () => {
  for (const duplicateHandle of [false, true]) {
    const s = setup({ selection: [{ kind: 'edge', index: 0 }], duplicateHandle })
    s.layer.pointerDown!(s.event('pointerdown', 125, 100)); s.canvas.dispatchEvent(s.event('pointerup', 125, 120))
    expect(s.onCommit).toHaveBeenCalledTimes(1)
    const result = s.onCommit.mock.calls[0][0] as Cage
    expect(result.faces.length).toBe(duplicateHandle ? 2 : 1)
    expect(result.positions.length).toBe(duplicateHandle ? 18 : 12)
    if (duplicateHandle) expect(Array.from(result.positions.slice(0, 12))).toEqual(Array.from(s.cage.positions))
    else { expect(result.positions[1]).toBeCloseTo(-2); expect(result.positions[4]).toBeCloseTo(-2) }
    s.editor.dispose()
  }
})
it('keeps D-handle travel uniform while contextual Extrapolate follows the face tangents', () => {
  const bent: Cage = {
    positions: Float64Array.from([0,0,0, 5,0,0, 6,5,3, 0,5,2]),
    faces: [[0,1,2,3]], creases: [],
  }
  for (const contextual of [false, true]) {
    const s = setup({
      selection: [{kind:'edge',index:0}], duplicateHandle: !contextual,
      extrapolate: contextual,
    }, bent)
    expect(s.layer.pointerDown!(s.event('pointerdown',125,100))).toBe(true)
    s.canvas.dispatchEvent(s.event('pointermove',125,120))
    const preview = s.onPreview.mock.lastCall?.[0] as Cage
    expect(preview.faces).toHaveLength(2)
    s.canvas.dispatchEvent(s.event('pointerup',125,120))
    const result = s.onCommit.mock.lastCall?.[0] as Cage
    expect(result.faces).toHaveLength(2)
    if (!contextual) {
      expect(result.positions[12]).toBeCloseTo(0)
      expect(result.positions[13]).toBeCloseTo(-2)
      expect(result.positions[15]).toBeCloseTo(5)
      expect(result.positions[16]).toBeCloseTo(-2)
      expect(result.positions[17]).toBeCloseTo(0)
    } else {
      expect(Math.abs(result.positions[14])).toBeGreaterThan(0.1)
      expect(Math.abs(result.positions[17])).toBeGreaterThan(0.1)
    }
    s.editor.dispose()
  }
})
it('selects faces and moves all their vertices together', () => {
  const s = setup({ mode: 'faces' })
  expect(s.layer.pointerDown!(s.event('pointerdown', 125, 75))).toBe(true)
  s.canvas.dispatchEvent(s.event('pointerup', 145, 75))
  expect(s.onSelection).toHaveBeenCalledWith([{ kind: 'face', index: 0 }])
  const result = s.onCommit.mock.calls[0][0] as Cage
  for (let i = 0; i < 4; i++) expect(result.positions[i * 3] - s.cage.positions[i * 3]).toBeCloseTo(2)
  s.editor.dispose()
})
it('hidden faces cannot be selected through vertices, edges or face interiors', () => {
  for (const mode of ['points-edges', 'points', 'edges', 'faces', 'all'] as const) {
    const s = setup({ mode, hiddenFaces: [0] })
    for (const [x, y] of [[100, 100], [125, 100], [125, 75]]) { expect(s.layer.pointerDown!(s.event('pointerdown', x, y))).toBe(true);s.canvas.dispatchEvent(s.event('pointercancel',x,y)) }
    expect(s.onSelection).not.toHaveBeenCalled(); s.editor.dispose()
  }
})

it('selects a sloped face boundary a few pixels inside the visible line', () => {
  const sloped:Cage={positions:Float64Array.from([0,0,0,5,0,0,5,5,5,0,5,5]),faces:[[0,1,2,3]],creases:[]}
  const s=setup({mode:'edges'},sloped)
  s.canvas.dispatchEvent(s.event('contextmenu',125,98))
  expect(s.onContext.mock.lastCall?.[2]).toEqual({kind:'edge',index:0})
  s.editor.dispose()
})
it('selects a sloped face corner near its interior without selecting an obscured rear corner', () => {
  const sloped:Cage={positions:Float64Array.from([0,0,0,5,0,0,5,5,5,0,5,5]),faces:[[0,1,2,3]],creases:[]}
  const s=setup({mode:'points'},sloped)
  s.canvas.dispatchEvent(s.event('contextmenu',102,98))
  expect(s.onContext.mock.lastCall?.[2]).toEqual({kind:'vertex',index:0})
  s.editor.dispose()
  // The foreground face is less than the point-pick depth allowance away,
  // so only face ownership can prevent a rear point leaking through.
  const covered:Cage={positions:Float64Array.from([0,0,0,5,0,0,5,5,0,0,5,0,-2,-2,.7,7,-2,.7,7,7,.7,-2,7,.7]),faces:[[0,1,2,3],[4,5,6,7]],creases:[]}
  const rear=setup({mode:'points'},covered)
  rear.canvas.dispatchEvent(rear.event('contextmenu',100,100))
  expect(rear.onContext.mock.lastCall?.[2]).toBeNull()
  rear.editor.dispose()
})

it('selection filters take only their entity types, with points then edges then faces in All', () => {
  const expected: Record<FreeformSelectionMode, (string | null)[]> = {
    'points-edges': ['vertex', 'edge', null], points: ['vertex', null, null],
    edges: ['edge', 'edge', null], boundary: ['edge', 'edge', null], faces: ['face', 'face', 'face'], all: ['vertex', 'edge', 'face'],
  }
  for (const mode of Object.keys(expected) as FreeformSelectionMode[]) {
    const s = setup({ mode })
    for (const [i, [x, y]] of [[100, 100], [125, 100], [125, 75]].entries()) {
      s.canvas.dispatchEvent(s.event('contextmenu', x, y))
      expect(s.onContext.mock.lastCall?.[2]?.kind ?? null, `${mode} at ${x},${y}`).toBe(expected[mode][i])
    }
    expect(s.onCommit).not.toHaveBeenCalled(); s.editor.dispose()
  }
})

it('changing filters preserves selected points while hiding unselected point markers in Edges and Faces', () => {
  const selection = [{ kind: 'vertex' as const, index: 0 }], s = setup({ selection })
  const markers = () => (s.partGroup.children[0] as THREE.Group).children.find(object => object instanceof THREE.Points) as THREE.Points
  expect(markers().geometry.getAttribute('position').count).toBe(4)
  for (const mode of ['edges', 'faces', 'points', 'all'] as const) {
    s.editor.set(s.cage, { mode, selection, onSelection: s.onSelection, onCommit: s.onCommit })
    const positions = markers().geometry.getAttribute('position'), colors = markers().geometry.getAttribute('color')
    expect(positions.count).toBe(mode === 'edges' || mode === 'faces' ? 1 : 4)
    expect([positions.getX(0), positions.getY(0), positions.getZ(0)]).toEqual([0, 0, 0])
    expect(colors.getX(0)).toBe(1) // selected yellow remains visible
  }
  expect(s.onSelection).not.toHaveBeenCalled(); expect(s.onCommit).not.toHaveBeenCalled(); s.editor.dispose()
})

it('a retained selected edge cannot duplicate through Points or Faces filters', () => {
  for (const mode of ['points', 'faces'] as const) {
    const s = setup({ mode, selection: [{ kind: 'edge', index: 0 }], duplicateHandle: true })
    const claimed = s.layer.pointerDown!(s.event('pointerdown', 125, 100))
    if (mode === 'points') {
      expect(claimed).toBe(true)
      // Empty-space box release clears the preserved, filtered-out edge.
      s.canvas.dispatchEvent(s.event('pointerup',125,100))
      expect(s.onSelection).toHaveBeenLastCalledWith([])
    } else {
      expect(claimed).toBe(true)
      expect(s.onSelection).toHaveBeenLastCalledWith([{ kind: 'face', index: 0 }])
    }
    s.canvas.dispatchEvent(s.event('pointerup', 125, 120))
    for (const call of s.onCommit.mock.calls) expect((call[0] as Cage).faces).toHaveLength(1)
    if (mode === 'points') expect(s.onCommit).not.toHaveBeenCalled()
    s.editor.dispose()
  }
})

const roundedCube = (): Cage => ({
  positions: Float64Array.from([-5,-5,-5, 5,-5,-5, 5,5,-5, -5,5,-5, -5,-5,5, 5,-5,5, 5,5,5, -5,5,5]),
  faces: [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]], creases: [],
})

it('curved face picking rejects empty space inside the raw cage silhouette', () => {
  const s = setup({ mode: 'faces' }, roundedCube())
  // A ray at (4.8,4.8) meets the raw cube top, but misses the rounded limit surface.
  expect(s.layer.pointerDown!(s.event('pointerdown', 148, 52))).toBe(true)
  s.canvas.dispatchEvent(s.event('pointerup',148,52))
  s.canvas.dispatchEvent(s.event('contextmenu', 148, 52))
  expect(s.onContext.mock.lastCall?.[2]).toBeNull()
  expect(s.layer.pointerDown!(s.event('pointerdown', 100, 100))).toBe(true)
  s.canvas.dispatchEvent(s.event('pointerup', 100, 100))
  expect(s.onSelection).toHaveBeenLastCalledWith([{ kind: 'face', index: 1 }])
  expect(s.onCommit).not.toHaveBeenCalled(); s.editor.dispose()
})

it('curved face picking maps the rendered side to its owning cage face and skips a hidden owner', () => {
  const s = setup({ mode: 'faces' }, roundedCube())
  // Near the round-over's right-hand silhouette, the side owns the visible surface,
  // whereas a raw cube proxy would incorrectly report its top face.
  s.canvas.dispatchEvent(s.event('contextmenu', 132.5, 100))
  expect(s.onContext.mock.lastCall?.[2]).toEqual({ kind: 'face', index: 3 })
  s.editor.set(s.cage, { mode: 'faces', hiddenFaces: [3], onContext: s.onContext })
  s.canvas.dispatchEvent(s.event('contextmenu', 132.5, 100))
  expect(s.onContext.mock.lastCall?.[2]?.index).not.toBe(3)
  s.editor.set(s.cage, { mode: 'faces', hiddenFaces: [0, 1, 2], onContext: s.onContext })
  s.canvas.dispatchEvent(s.event('contextmenu', 132.5, 100))
  expect(s.onContext.mock.lastCall?.[2]).toEqual({ kind: 'face', index: 3 })
  s.editor.dispose()
})

it('face picking follows snapped display geometry rather than the original control polygon', () => {
  const s = setup({ mode: 'faces', snapPoint: p => [p[0] + 3, p[1], 0.2 * p[0] * p[0]] })
  s.canvas.dispatchEvent(s.event('contextmenu', 165, 75)) // displayed surface outside raw x <= 5
  expect(s.onContext.mock.lastCall?.[2]).toEqual({ kind: 'face', index: 0 })
  s.canvas.dispatchEvent(s.event('contextmenu', 110, 75)) // old surface footprint is now empty
  expect(s.onContext.mock.lastCall?.[2]).toBeNull()
  expect(s.cage.positions[0]).toBe(0); expect(s.onCommit).not.toHaveBeenCalled(); s.editor.dispose()
})
it('Ctrl toggles selection without moving geometry', () => {
  const s = setup({ selection: [{ kind: 'vertex', index: 0 }] })
  s.layer.pointerDown!(s.event('pointerdown', 150, 100, { ctrlKey: true }))
  expect(s.onSelection).toHaveBeenLastCalledWith([{ kind: 'vertex', index: 0 }, { kind: 'vertex', index: 1 }])
  s.layer.pointerDown!(s.event('pointerdown', 100, 100, { ctrlKey: true }))
  expect(s.onSelection).toHaveBeenLastCalledWith([{ kind: 'vertex', index: 1 }])
  expect(s.onCommit).not.toHaveBeenCalled(); s.editor.dispose()
})
it('context click on selected geometry retains the multiple selection', () => {
  const selection = [{ kind: 'vertex' as const, index: 0 }, { kind: 'vertex' as const, index: 1 }]
  const s = setup({ selection })
  s.canvas.dispatchEvent(s.event('contextmenu'))
  expect(s.onSelection).not.toHaveBeenCalled()
  expect(s.onContext).toHaveBeenCalledWith(100, 100, selection[0]); s.editor.dispose()
})
it('right click adds a new entity and keeps the existing context selection', () => {
  const s = setup({ selection: [{ kind: 'vertex', index: 0 }] })
  s.canvas.dispatchEvent(s.event('contextmenu', 150, 100))
  expect(s.onSelection).toHaveBeenLastCalledWith([
    { kind: 'vertex', index: 0 }, { kind: 'vertex', index: 1 },
  ])
  s.canvas.dispatchEvent(s.event('contextmenu', 150, 100))
  s.canvas.dispatchEvent(s.event('contextmenu', 180, 180))
  expect(s.onSelection).toHaveBeenCalledTimes(1)
  s.editor.dispose()
})
it('right click on another edge keeps the original edge selected', () => {
  const s = setup({ selection: [{ kind: 'edge', index: 0 }], mode: 'edges' })
  s.canvas.dispatchEvent(s.event('contextmenu', 150, 75))
  expect(s.onSelection.mock.lastCall?.[0]).toEqual([
    { kind: 'edge', index: 0 }, { kind: 'edge', index: 1 },
  ])
  s.editor.dispose()
})
it('uses scan picks for creation and prevents fall-through', () => {
  const onCreatePoint = vi.fn(), s = setup({ creating: true, onCreatePoint })
  expect(s.layer.click!(130, 130, false)).toBe(true)
  expect(onCreatePoint).toHaveBeenCalledWith([1, 2, 3]); s.editor.dispose()
})
it('converts movement into the part coordinate frame', () => {
  const s = setup(); s.partGroup.rotation.z = Math.PI / 2; s.partGroup.updateMatrixWorld()
  s.layer.pointerDown!(s.event('pointerdown')); s.canvas.dispatchEvent(s.event('pointerup', 120))
  const result = s.onCommit.mock.calls[0][0] as Cage
  expect(result.positions[0]).toBeCloseTo(0); expect(result.positions[1]).toBeCloseTo(-2)
  s.editor.dispose()
})
it('zero strength and snapping back to the source do not create history entries', () => {
  for (const options of [{ strength: 0 }, { snapPoint: () => [0, 0, 0] as [number, number, number] }]) {
    const s = setup(options)
    s.layer.pointerDown!(s.event('pointerdown')); s.canvas.dispatchEvent(s.event('pointerup', 120))
    expect(s.onCommit).not.toHaveBeenCalled(); s.editor.dispose()
  }
})
it('snap failures cancel and release the gesture rather than committing a partial cage', () => {
  const onError = vi.fn(), s = setup({ snapPoint: () => { throw new Error('snap failed') }, onError })
  s.layer.pointerDown!(s.event('pointerdown')); s.canvas.dispatchEvent(s.event('pointermove', 120))
  s.canvas.dispatchEvent(s.event('pointerup', 120))
  expect(s.onCommit).not.toHaveBeenCalled()
  expect(onError.mock.calls[0][0].message).toBe('snap failed')
  expect(s.onPreview.mock.lastCall).toEqual([s.cage, false]); s.editor.dispose()
})
it('selection feedback through set does not cancel a drag on the same source cage', () => {
  const s = setup()
  s.layer.pointerDown!(s.event('pointerdown'))
  s.editor.set(s.cage, { selection: [{ kind: 'vertex', index: 0 }], onCommit: s.onCommit })
  s.canvas.dispatchEvent(s.event('pointerup', 120))
  expect(s.onCommit).toHaveBeenCalledTimes(1); s.editor.dispose()
})
it('disabled editor consumes clicks without selecting, creating, or dragging', () => {
  const onCreatePoint = vi.fn(), s = setup({ enabled: false, creating: true, onCreatePoint })
  expect(s.layer.pointerDown!(s.event('pointerdown'))).toBe(true)
  expect(s.layer.click!(100, 100, false)).toBe(true)
  s.canvas.dispatchEvent(s.event('contextmenu'))
  expect(s.onSelection).not.toHaveBeenCalled(); expect(s.onContext).not.toHaveBeenCalled(); expect(onCreatePoint).not.toHaveBeenCalled()
  expect(s.onCommit).not.toHaveBeenCalled(); s.editor.dispose()
})
it('projects refined preview samples onto the scan without changing the cage', () => {
  const snapPoint = vi.fn((p: [number, number, number]): [number, number, number] => [p[0], p[1], 2])
  const s = setup({ snapPoint })
  const group = s.partGroup.children[0] as THREE.Group
  const surface = group.children[0] as THREE.Mesh
  const positions = surface.geometry.getAttribute('position')
  for (let i = 0; i < positions.count; i++) expect(positions.getZ(i)).toBe(2)
  const calls = snapPoint.mock.calls.length
  s.layer.hover!({ x: 100, y: 100 }, false)
  expect(snapPoint).toHaveBeenCalledTimes(calls)
  expect(s.cage.positions[2]).toBe(0); s.editor.dispose()
})
it('rejects an extension parallel to the boundary edge without creating a degenerate face', () => {
  const s = setup({ selection: [{ kind: 'edge', index: 0 }], duplicateHandle: true })
  s.layer.pointerDown!(s.event('pointerdown', 125, 100)); s.canvas.dispatchEvent(s.event('pointerup', 145, 100))
  expect(s.onCommit).not.toHaveBeenCalled(); expect(s.onPreview.mock.lastCall).toEqual([s.cage, false]); s.editor.dispose()
})
it('cancels uncommitted dragging before an undo shortcut and ignores the stale release', () => {
  const s = setup()
  s.layer.pointerDown!(s.event('pointerdown')); s.canvas.dispatchEvent(s.event('pointermove', 120))
  s.win.dispatchEvent(Object.assign(new Event('keydown'), { key: 'z', ctrlKey: true }))
  s.canvas.dispatchEvent(s.event('pointerup', 120))
  expect(s.onCommit).not.toHaveBeenCalled(); expect(s.onPreview.mock.lastCall).toEqual([s.cage, false]); s.editor.dispose()
})
it('does not commit an extension when snapping collapses its new edges', () => {
  const s = setup({ selection: [{ kind: 'edge', index: 0 }], duplicateHandle: true, snapPoint: p => [p[0], 0, 0] })
  s.layer.pointerDown!(s.event('pointerdown', 125, 100)); s.canvas.dispatchEvent(s.event('pointerup', 125, 120))
  expect(s.onCommit).not.toHaveBeenCalled(); s.editor.dispose()
})

it('keeps an invalid inward D pull alive and commits once after recovering outward', () => {
  const onError = vi.fn(), s = setup({ selection: [{ kind: 'edge', index: 0 }], duplicateHandle: true, onError })
  s.layer.pointerDown!(s.event('pointerdown', 125, 100))
  s.canvas.dispatchEvent(s.event('pointermove', 125, 80))
  expect(s.onPreview).toHaveBeenLastCalledWith(s.cage, true)
  expect(s.host.setCursor).toHaveBeenLastCalledWith('not-allowed')
  expect(s.canvas.releasePointerCapture).not.toHaveBeenCalled()
  expect(s.onCommit).not.toHaveBeenCalled()
  s.canvas.dispatchEvent(s.event('pointermove', 125, 120))
  expect(s.host.setCursor).toHaveBeenLastCalledWith('copy')
  expect((s.onPreview.mock.lastCall?.[0] as Cage).faces).toHaveLength(2)
  s.canvas.dispatchEvent(s.event('pointerup', 125, 120))
  expect(s.onCommit).toHaveBeenCalledOnce()
  expect(topology(s.onCommit.mock.lastCall?.[0]).edges.filter(edge => edge.faces.length === 2)).toHaveLength(1)
  expect(onError).not.toHaveBeenCalled()
  expect(s.cage.faces).toEqual([[0,1,2,3]])
  s.editor.dispose()
})

it.each(['release', 'cancel'])('rejects a post-snap inward folded D extension on %s', action => {
  const onError = vi.fn(), s = setup({ selection: [{ kind: 'edge', index: 0 }], duplicateHandle: true,
    snapPoint: p => [p[0], Math.abs(p[1]), p[2]], onError })
  s.layer.pointerDown!(s.event('pointerdown', 125, 100))
  s.canvas.dispatchEvent(s.event('pointermove', 125, 120))
  if (action === 'cancel') s.win.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }))
  s.canvas.dispatchEvent(s.event('pointerup', 125, 120))
  expect(s.onCommit).not.toHaveBeenCalled()
  expect(s.onPreview).toHaveBeenLastCalledWith(s.cage, false)
  expect(onError).not.toHaveBeenCalled()
  expect(s.cage.faces).toEqual([[0,1,2,3]])
  s.editor.dispose()
})

const strip: Cage = { positions: Float64Array.from([0,0,0, 5,0,0, 10,0,0, 0,5,0, 5,5,0, 10,5,0]), faces:[[0,1,4,3],[1,2,5,4]], creases:[] }
it('Boundary mode selects the entire connected perimeter on one click', () => {
  const s=setup({mode:'boundary'},strip)
  s.layer.pointerDown!(s.event('pointerdown',125,100));s.canvas.dispatchEvent(s.event('pointerup',125,100))
  expect(s.onSelection.mock.lastCall?.[0]).toEqual([0,2,3,4,5,6].map(index=>({kind:'edge',index})))
  s.canvas.dispatchEvent(s.event('dblclick',125,100))
  expect(s.onSelection.mock.lastCall?.[0]).toHaveLength(6)
  expect(s.onCommit).not.toHaveBeenCalled();s.editor.dispose()
})
it('Boundary context adds a second perimeter and Control removes one complete perimeter', () => {
  const c:Cage={positions:Float64Array.from([0,0,0,2,0,0,2,2,0,0,2,0,4,0,0,6,0,0,6,2,0,4,2,0]),faces:[[0,1,2,3],[4,5,6,7]],creases:[]}
  const s=setup({mode:'boundary'},c)
  s.canvas.dispatchEvent(s.event('contextmenu',110,100))
  expect(s.onSelection.mock.lastCall?.[0]).toHaveLength(4)
  s.canvas.dispatchEvent(s.event('contextmenu',150,100))
  expect(s.onSelection.mock.lastCall?.[0]).toHaveLength(8)
  s.layer.pointerDown!(s.event('pointerdown',110,100,{ctrlKey:true}))
  expect(s.onSelection.mock.lastCall?.[0]).toEqual([4,5,6,7].map(index=>({kind:'edge',index})))
  expect(s.onCommit).not.toHaveBeenCalled();s.editor.dispose()
})
it('Boundary mode does not box-select internal or hidden geometry', () => {
  const s=setup({mode:'boundary',hiddenFaces:[1]},strip)
  s.canvas.dispatchEvent(s.event('contextmenu',125,100))
  expect(s.onSelection.mock.lastCall?.[0]).toEqual([0,2,3].map(index=>({kind:'edge',index})))
  s.layer.pointerDown!(s.event('pointerdown',80,40));s.canvas.dispatchEvent(s.event('pointerup',210,120))
  expect(s.onSelection.mock.lastCall?.[0]).toEqual([])
  expect(s.onCommit).not.toHaveBeenCalled();s.editor.dispose()
})
it('double-click selects the boundary line, stops at corners and does not change geometry', () => {
  const s=setup({},strip)
  s.canvas.dispatchEvent(s.event('dblclick',125,100))
  expect(s.onSelection.mock.lastCall?.[0]).toEqual([{kind:'edge',index:0},{kind:'edge',index:4}])
  expect(s.onCommit).not.toHaveBeenCalled();s.editor.dispose()
})
it('double-click cannot traverse a hidden face and respects the points-only filter', () => {
  for(const options of [{hiddenFaces:[1]}, {mode:'points' as const}]) {
    const s=setup(options,strip);s.canvas.dispatchEvent(s.event('dblclick',125,100))
    if(options.mode) expect(s.onSelection).not.toHaveBeenCalled()
    else expect(s.onSelection.mock.lastCall?.[0]).toEqual([{kind:'edge',index:0}])
    s.editor.dispose()
  }
})
it('D drag extends an entire boundary line with a welded shared vertex and selects the new boundary', () => {
  const s=setup({duplicateHandle:true},strip)
  s.canvas.dispatchEvent(s.event('dblclick',125,100))
  s.layer.pointerDown!(s.event('pointerdown',125,100));s.canvas.dispatchEvent(s.event('pointerup',125,120))
  expect(s.onCommit).toHaveBeenCalledTimes(1)
  const [next,picks]=s.onCommit.mock.calls[0] as [Cage,{kind:string;index:number}[]]
  expect(next.faces).toHaveLength(4);expect(next.positions.length/3).toBe(9)
  expect(next.faces[2].filter(v=>next.faces[3].includes(v))).toHaveLength(2)
  expect(picks).toHaveLength(2);expect(picks.every(p=>p.kind==='edge')).toBe(true)
  expect(Array.from(next.positions.slice(0,18))).toEqual(Array.from(strip.positions))
  s.editor.dispose()
})
it('multi-edge D drag cancellation preserves the original cage and creates no commit', () => {
  const s=setup({duplicateHandle:true},strip);s.canvas.dispatchEvent(s.event('dblclick',125,100))
  s.layer.pointerDown!(s.event('pointerdown',125,100));s.canvas.dispatchEvent(s.event('pointermove',125,120))
  s.win.dispatchEvent(Object.assign(new Event('keydown'),{key:'Escape'}));s.canvas.dispatchEvent(s.event('pointerup',125,120))
  expect(s.onCommit).not.toHaveBeenCalled();expect(s.onPreview.mock.lastCall?.[0]).toBe(strip);s.editor.dispose()
})
it('D handle has copy cursor while plain edge dragging still moves existing vertices', () => {
  const s=setup({duplicateHandle:true},strip);s.canvas.dispatchEvent(s.event('dblclick',125,100))
  s.layer.hover!({x:125,y:100},false);expect(s.host.setCursor).toHaveBeenCalledWith('copy')
  s.layer.pointerDown!(s.event('pointerdown',110,100));s.canvas.dispatchEvent(s.event('pointerup',110,120))
  expect(s.onCommit.mock.calls[0][0].faces).toHaveLength(2);s.editor.dispose()
})

it('two released pointer clicks select a line even when the scene suppresses mouse events', () => {
 const s=setup({},strip)
 for(let i=0;i<2;i++){s.layer.pointerDown!(s.event('pointerdown',125,100));s.canvas.dispatchEvent(s.event('pointerup',125,100))}
 expect(s.onSelection.mock.lastCall?.[0]).toEqual([{kind:'edge',index:0},{kind:'edge',index:4}]);expect(s.onCommit).not.toHaveBeenCalled();s.editor.dispose()
})

it('Control Net off keeps unselected boundary edges available to context selection', () => {
 const s=setup({controlNet:false,mode:'edges'})
 s.canvas.dispatchEvent(s.event('contextmenu',125,100));expect(s.onContext.mock.lastCall?.[2]).toEqual({kind:'edge',index:0});s.editor.dispose()
})
it('Control Net off picks a deformed boundary anchor at the surface limit, not the raw pole', () => {
 const bent:Cage={...strip,positions:strip.positions.slice()};bent.positions[4]=-12
 const s=setup({controlNet:false,mode:'points'},bent)
 // Boundary limit mask: (left + 4*middle + right)/6 -> (5,-8,0).
 s.canvas.dispatchEvent(s.event('contextmenu',150,180));expect(s.onContext.mock.lastCall?.[2]).toEqual({kind:'vertex',index:1})
 s.canvas.dispatchEvent(s.event('contextmenu',150,220));expect(s.onContext.mock.lastCall?.[2]).toBeNull();s.editor.dispose()
})
it('Control Net off drags the picked surface anchor by the full cursor distance', () => {
 const bent:Cage={...strip,positions:strip.positions.slice()};bent.positions[4]=-12
 const s=setup({controlNet:false,mode:'points'},bent)
 const before=cageVertexLimits(bent)[1]
 s.layer.pointerDown!(s.event('pointerdown',150,180));s.canvas.dispatchEvent(s.event('pointerup',170,180))
 expect(s.onCommit).toHaveBeenCalledTimes(1)
 const next=s.onCommit.mock.calls[0][0] as Cage
 expect(cageVertexLimits(next)[1][0]-before[0]).toBeCloseTo(2)
 expect(next.positions[3]-bent.positions[3]).toBeGreaterThan(2)
 s.editor.dispose()
})
it('Control Net off places the move manipulator at the selected surface anchor', () => {
 const bent:Cage={...strip,positions:strip.positions.slice()};bent.positions[4]=-12
 const s=setup({controlNet:false,mode:'points',selection:[{kind:'vertex',index:1}],manipulator:'world'},bent)
 s.layer.tick!(200,200)
 expect(s.layer.pointerDown!(s.event('pointerdown',207,180))).toBe(true)
 s.canvas.dispatchEvent(s.event('pointerup',227,180))
 expect(s.onCommit).toHaveBeenCalledTimes(1)
 const next=s.onCommit.mock.calls[0][0] as Cage
 expect(cageVertexLimits(next)[1][0]-cageVertexLimits(bent)[1][0]).toBeCloseTo(2)
 s.editor.dispose()
})
it('hidden surface-mode geometry remains unpickable', () => {
 const s=setup({controlNet:false,hiddenFaces:[0],mode:'edges'});s.canvas.dispatchEvent(s.event('contextmenu',125,100));expect(s.onContext.mock.lastCall?.[2]).toBeNull();s.editor.dispose()
})
it('surface-mode boundary line can be duplicated without revealing the raw control net', () => {
 const s=setup({controlNet:false,duplicateHandle:true},strip);s.canvas.dispatchEvent(s.event('dblclick',125,100))
 s.layer.pointerDown!(s.event('pointerdown',125,100));s.canvas.dispatchEvent(s.event('pointermove',125,120));s.canvas.dispatchEvent(s.event('pointerup',125,120))
 expect(s.onCommit).toHaveBeenCalledTimes(1);expect(s.onCommit.mock.calls[0][0].faces).toHaveLength(4);expect(s.onCommit.mock.calls[0][0].positions.length/3).toBe(9);s.editor.dispose()
})

it('Extrapolate mode extends an edge away from the D handle and Undo source remains immutable', () => {
 const s=setup({extrapolate:true,duplicateHandle:false,selection:[{kind:'edge',index:0}]})
 s.layer.pointerDown!(s.event('pointerdown',115,100));s.canvas.dispatchEvent(s.event('pointerup',115,130))
 const result=s.onCommit.mock.calls[0][0] as Cage
 expect(result.faces).toHaveLength(2);expect(Array.from(result.positions.slice(0,12))).toEqual(Array.from(s.cage.positions));s.editor.dispose()
})
it('Extrapolate mode rejects internal edges instead of moving them', () => {
 const s=setup({extrapolate:true,duplicateHandle:false},strip)
 s.layer.pointerDown!(s.event('pointerdown',150,75));s.canvas.dispatchEvent(s.event('pointerup',175,75))
 expect(s.onCommit).not.toHaveBeenCalled();s.editor.dispose()
})
it('Extrapolate mode cancellation leaves no geometry or history change', () => {
 const s=setup({extrapolate:true,duplicateHandle:false})
 s.layer.pointerDown!(s.event('pointerdown',115,100));s.canvas.dispatchEvent(s.event('pointermove',115,130));s.canvas.dispatchEvent(s.event('pointercancel',115,130))
 expect(s.onCommit).not.toHaveBeenCalled();s.editor.dispose()
})

it('box selection encloses edges in either direction and excludes partial edges', () => {
 for(const reverse of [false,true]){
 const s=setup({mode:'edges'});const a: [number,number]=reverse?[160,110]:[90,40],b: [number,number]=reverse?[90,40]:[160,110]
 s.layer.pointerDown!(s.event('pointerdown',...a));s.canvas.dispatchEvent(s.event('pointerup',...b));expect(s.onSelection.mock.lastCall?.[0]).toHaveLength(4)
 s.layer.pointerDown!(s.event('pointerdown',90,65));s.canvas.dispatchEvent(s.event('pointerup',110,85));expect(s.onSelection.mock.lastCall?.[0]).toEqual([]);expect(s.onCommit).not.toHaveBeenCalled();s.editor.dispose()
 }
})
it('box selection filters points and faces and excludes hidden geometry', () => {
 for(const mode of ['points','faces'] as const){const s=setup({mode});s.layer.pointerDown!(s.event('pointerdown',90,40));s.canvas.dispatchEvent(s.event('pointerup',160,110));expect(s.onSelection.mock.lastCall?.[0]).toHaveLength(mode==='points'?4:1);s.editor.dispose()}
 const s=setup({mode:'all',hiddenFaces:[0]});s.layer.pointerDown!(s.event('pointerdown',90,40));s.canvas.dispatchEvent(s.event('pointerup',160,110));expect(s.onSelection.mock.lastCall?.[0]).toEqual([]);s.editor.dispose()
})
it('Shift click removes a selected point without starting a geometry drag', () => {
 const s=setup({mode:'points',selection:[{kind:'vertex',index:0},{kind:'vertex',index:1}]})
 expect(s.layer.pointerDown!(s.event('pointerdown',100,100,{shiftKey:true}))).toBe(true)
 expect(s.onSelection.mock.lastCall?.[0]).toEqual([{kind:'vertex',index:1}])
 s.canvas.dispatchEvent(s.event('pointerup',120,120,{shiftKey:true}))
 expect(s.onCommit).not.toHaveBeenCalled();s.editor.dispose()
})
it('Shift rectangle removes enclosed points while Ctrl rectangle adds them', () => {
 const s=setup({mode:'points',selection:[{kind:'vertex',index:0},{kind:'vertex',index:1}]})
 s.layer.pointerDown!(s.event('pointerdown',90,90,{shiftKey:true}))
 s.canvas.dispatchEvent(s.event('pointerup',110,110,{shiftKey:true}))
 expect(s.onSelection.mock.lastCall?.[0]).toEqual([{kind:'vertex',index:1}])
 s.layer.pointerDown!(s.event('pointerdown',90,90,{ctrlKey:true}))
 s.canvas.dispatchEvent(s.event('pointerup',110,110,{ctrlKey:true}))
 expect(s.onSelection.mock.lastCall?.[0]).toEqual([{kind:'vertex',index:1},{kind:'vertex',index:0}])
 expect(s.onCommit).not.toHaveBeenCalled();s.editor.dispose()
})
it('Alt drag extends a boundary edge when the D handle is hidden', () => {
 const s=setup({selection:[{kind:'edge',index:0}],duplicateHandle:false})
 expect(s.layer.pointerDown!(s.event('pointerdown',125,100,{altKey:true}))).toBe(true)
 s.canvas.dispatchEvent(s.event('pointermove',125,120,{altKey:true}))
 expect((s.onPreview.mock.lastCall?.[0] as Cage).faces).toHaveLength(2)
 s.canvas.dispatchEvent(s.event('pointerup',125,120,{altKey:true}))
 expect((s.onCommit.mock.lastCall?.[0] as Cage).faces).toHaveLength(2)
 expect(Array.from(s.cage.positions)).toEqual([0,0,0,5,0,0,5,5,0,0,5,0]);s.editor.dispose()
})
it('Escape cancels a box without replacing the existing selection', () => {
 const s=setup({mode:'points',selection:[{kind:'vertex',index:0}]});s.layer.pointerDown!(s.event('pointerdown',90,40));s.canvas.dispatchEvent(s.event('pointermove',160,110));s.win.dispatchEvent(Object.assign(new Event('keydown'),{key:'Escape'}));s.canvas.dispatchEvent(s.event('pointerup',160,110));expect(s.onSelection).not.toHaveBeenCalled();expect(s.onCommit).not.toHaveBeenCalled();s.editor.dispose()
})
it('a selected rear boundary does not expose a D handle through a foreground face', () => {
 const input:Cage={positions:Float64Array.from([0,0,0,5,0,0,5,5,0,0,5,0,-2,-2,2,7,-2,2,7,7,2,-2,7,2]),faces:[[0,1,2,3],[4,5,6,7]],creases:[]}
 const s=setup({duplicateHandle:true,selection:[{kind:'edge',index:0}]},input)
 expect((s.editor as any).duplicateAnchor()).toBeNull();s.editor.dispose()
})

for (const controlNet of [true, false]) it(`merges one open-chain endpoint and retains both selected edges (Control Net ${controlNet})`, () => {
  const cage: Cage = { positions: Float64Array.from(chainMerge.input.positions), faces: chainMerge.input.faces, creases: [] }
  const top = topology(cage), selection = chainMerge.selectedEdges.map(([a,b]) => ({kind:'edge' as const,index:top.edges.findIndex(e=>(e.a===a&&e.b===b)||(e.a===b&&e.b===a))}))
  const s=setup({mode:'edges',controlNet,selection},cage)
  const x=100+cage.positions[6]*10, y=100-(cage.positions[7]+cage.positions[25])*5
  s.layer.pointerDown!(s.event('pointerdown',x,y));s.canvas.dispatchEvent(s.event('pointermove',x+chainMerge.delta*10,y))
  expect(s.onCommit).not.toHaveBeenCalled();expect(s.onPreview.mock.lastCall?.[0].positions.length).toBe(33)
  s.canvas.dispatchEvent(s.event('pointerup',x+chainMerge.delta*10,y))
  expect(s.onCommit).toHaveBeenCalledTimes(1)
  const [next,picks]=s.onCommit.mock.lastCall! as [Cage,{kind:string;index:number}[]]
  expect(next.faces).toEqual(chainMerge.expected.faces)
  expect(Math.max(...next.positions.map((v,i)=>Math.abs(v-chainMerge.expected.positions[i])))).toBeLessThan(5e-7)
  expect(picks).toHaveLength(2);expect(picks.every(p=>p.kind==='edge')).toBe(true)
  expect(Array.from(cage.positions)).toEqual(chainMerge.input.positions);s.editor.dispose()
})
it('cancels a previewed chain weld without changing topology or history',()=>{
 const cage:Cage={positions:Float64Array.from(chainMerge.input.positions),faces:chainMerge.input.faces,creases:[]},top=topology(cage)
 const selection=chainMerge.selectedEdges.map(([a,b])=>({kind:'edge' as const,index:top.edges.findIndex(e=>(e.a===a&&e.b===b)||(e.a===b&&e.b===a))}))
 const s=setup({mode:'edges',controlNet:true,selection},cage),x=100+cage.positions[6]*10,y=100-(cage.positions[7]+cage.positions[25])*5
 s.layer.pointerDown!(s.event('pointerdown',x,y));s.canvas.dispatchEvent(s.event('pointermove',x+chainMerge.delta*10,y));s.win.dispatchEvent(Object.assign(new Event('keydown'),{key:'Escape'}));s.canvas.dispatchEvent(s.event('pointerup',x+chainMerge.delta*10,y));expect(s.onCommit).not.toHaveBeenCalled();expect(s.onPreview.mock.lastCall).toEqual([cage,false]);s.editor.dispose()
})

for(const f of surfaceDrags) it(`direct surface-point pointer gesture matches native ${f.name}`,()=>{
 const cage:Cage={positions:Float64Array.from(f.input.positions),faces:f.input.faces,creases:[]},anchors=cageVertexLimits(cage),a=anchors[f.vertex]
 const s=setup({mode:'points',controlNet:false,neighbourRadius:0},cage),x=100+a[0]*10,y=100-a[1]*10,tx=x+f.travel[0]*10
 s.layer.pointerDown!(s.event('pointerdown',x,y));s.canvas.dispatchEvent(s.event('pointermove',tx,y));expect(s.onCommit).not.toHaveBeenCalled();s.canvas.dispatchEvent(s.event('pointerup',tx,y));expect(s.onCommit).toHaveBeenCalledTimes(1)
 const result=s.onCommit.mock.lastCall?.[0] as Cage;expect(result.faces).toEqual(f.expected.faces);expect(Math.max(...result.positions.map((v,i)=>Math.abs(v-f.expected.positions[i])))).toBeLessThan(5e-7);s.editor.dispose()
})

for(const f of snappedDrags) it(`snapped surface-point pointer gesture matches native ${f.name}`,()=>{
 const cage:Cage={positions:Float64Array.from(f.input.positions),faces:f.input.faces,creases:[]},a=cageVertexLimits(cage)[f.vertex]
 const s=setup({mode:'points',controlNet:false,neighbourRadius:f.keepNeighbours?0:2,snapPoint:p=>[p[0],p[1],0]},cage),x=100+a[0]*10,y=100-a[1]*10,tx=x+f.travel[0]*10
 s.host.pickScan=vi.fn((x:number,y:number)=>({point:[(x-100)/10,(100-y)/10,0]})) as unknown as typeof s.host.pickScan
 s.layer.pointerDown!(s.event('pointerdown',x,y));s.canvas.dispatchEvent(s.event('pointermove',tx,y));expect(s.onCommit).not.toHaveBeenCalled()
 const preview=s.onPreview.mock.lastCall?.[0] as Cage;expect(preview.faces).toEqual(f.expected.faces)
 s.canvas.dispatchEvent(s.event('pointerup',tx,y));expect(s.onCommit).toHaveBeenCalledTimes(1)
 const result=s.onCommit.mock.lastCall?.[0] as Cage;expect(result.faces).toEqual(f.expected.faces);expect(Math.max(...result.positions.map((v,i)=>Math.abs(v-f.expected.positions[i])))).toBeLessThan(5e-7)
 expect(Array.from(cage.positions)).toEqual(f.input.positions);s.editor.dispose()
})

it('cancels a snapped surface-point merge without committing its shared vertex',()=>{
 const f=snappedDrags.find(f=>f.name==='corner-snap-on-contact')!,cage:Cage={positions:Float64Array.from(f.input.positions),faces:f.input.faces,creases:[]},a=cageVertexLimits(cage)[f.vertex]
 const s=setup({mode:'points',controlNet:false,neighbourRadius:0,snapPoint:p=>[p[0],p[1],0]},cage),x=100+a[0]*10,y=100-a[1]*10,tx=x+f.travel[0]*10
 s.layer.pointerDown!(s.event('pointerdown',x,y));s.canvas.dispatchEvent(s.event('pointermove',tx,y));expect(s.onPreview.mock.lastCall?.[0].faces).toEqual(f.expected.faces)
 s.win.dispatchEvent(Object.assign(new Event('keydown'),{key:'Escape'}));s.canvas.dispatchEvent(s.event('pointerup',tx,y));expect(s.onCommit).not.toHaveBeenCalled();expect(s.onPreview.mock.lastCall).toEqual([cage,false]);s.editor.dispose()
})

it('keeps a snapped surface-point move atomic when the scan has no correspondence',()=>{
 const f=snappedDrags[1],cage:Cage={positions:Float64Array.from(f.input.positions),faces:f.input.faces,creases:[]},a=cageVertexLimits(cage)[f.vertex]
 const s=setup({mode:'points',controlNet:false,neighbourRadius:0,snapPoint:()=>null},cage),x=100+a[0]*10,y=100-a[1]*10,tx=x+f.travel[0]*10
 s.layer.pointerDown!(s.event('pointerdown',x,y));s.canvas.dispatchEvent(s.event('pointermove',tx,y));s.canvas.dispatchEvent(s.event('pointerup',tx,y));expect(s.onCommit).not.toHaveBeenCalled();expect(Array.from(cage.positions)).toEqual(f.input.positions);s.editor.dispose()
})

it('paints the measured fourth-corner candidate before a click without creating geometry or history', () => {
  const measure=vi.fn((p:Float32Array)=>Float32Array.from({length:p.length/3},(_,i)=>p[i*3+2]))
  const range=vi.fn(), options:FreeformEditorOptions={creating:true,creationCorners:[[0,0,0],[5,0,0],[5,5,0]],display:'deviation',measureDeviation:async p=>measure(p),measureLiveDeviation:measure,onDeviation:range,fitToScan:false}
  const s=setup(options,{positions:new Float64Array(),faces:[],creases:[]})
  s.layer.hover!({x:130,y:130},false)
  const mesh=s.partGroup.getObjectByName('freeform-deviation-surface') as THREE.Mesh
  expect(mesh.visible).toBe(true)
  expect(mesh.geometry.getAttribute('analysisCoordinates')).toBeDefined()
  expect(range).toHaveBeenLastCalledWith(expect.objectContaining({preview:true}))
  expect(s.onCommit).not.toHaveBeenCalled();expect(s.cage.faces).toHaveLength(0)
  s.layer.hover!(null,true)
  expect(s.partGroup.getObjectByName('freeform-deviation-surface')).toBeUndefined()
  s.editor.dispose()
})
