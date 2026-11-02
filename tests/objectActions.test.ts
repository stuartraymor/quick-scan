// SPDX-License-Identifier: AGPL-3.0-only
import {afterEach,beforeEach,describe,expect,it} from 'vitest'
import {useStore} from '../src/state/store'
import {useFlat} from '../src/state/flatStore'
import {useDeviation} from '../src/state/deviationStore'
import {useThickness} from '../src/state/thicknessStore'
import {useShell} from '../src/state/shellStore'
import {useDocumentOrder} from '../src/state/documentOrderStore'
import {clearHistory,configureHistory,installHistory,undo,redo} from '../src/state/historyStore'
import {duplicateCoreElement,objectDeleteKey,renameCoreObject} from '../src/app/objectActions'
let uninstall:()=>void, unconfigure:()=>void
const m=()=>useStore.getState()
beforeEach(()=>{
 useStore.setState(useStore.getInitialState(),true)
 useFlat.setState(useFlat.getInitialState(),true)
 useDeviation.setState(useDeviation.getInitialState(),true)
 useThickness.setState(useThickness.getInitialState(),true)
 useShell.getState().setWorkspace('elements')
 useDocumentOrder.setState(useDocumentOrder.getInitialState(),true)
 clearHistory();unconfigure=configureHistory({});uninstall=installHistory()
 useStore.setState({nextId:2,elements:[{id:1,kind:'plane',name:'Plane 1',color:'#123456',visible:true,status:'done',
  source:{type:'constructed',method:'plane-coords',refs:[],params:[0,0,1,0,0,0]},
  fit:{kind:'plane',center:[0,0,0],normal:[0,0,1],basisU:[1,0,0],basisV:[0,1,0],extentU:10,extentV:10,sigma:0,usedPoints:0,regionSize:0}}]})
})
afterEach(()=>{uninstall();unconfigure()})
describe('core object actions',()=>{
 it('blocks rename and duplication while the document is rolled back',()=>{
  useDocumentOrder.setState({rollbackAt:1})
  expect(duplicateCoreElement(1)).toBeNull()
  expect(renameCoreObject('element',1,'Wrong')).toBe(false)
  expect(m().elements).toHaveLength(1)
 })
 it('keeps an independent duplicate when its original is deleted and restores deletion with undo',async()=>{
  const id=duplicateCoreElement(1)!
  m().removeElement(1)
  expect(m().elements.map(e=>e.id)).toEqual([id])
  await undo()
  expect(m().elements.map(e=>e.id)).toEqual([1,id])
  await redo()
  expect(m().elements.map(e=>e.id)).toEqual([id])
 })
 it('duplicates with distinct IDs, independent nested data and undo/redo',async()=>{
  expect(duplicateCoreElement(1)).toBe(2)
  expect(duplicateCoreElement(1)).toBe(3)
  expect(m().elements.map(e=>e.name)).toEqual(['Plane 1','Plane 1 copy','Plane 1 copy 2'])
  expect(m().elements[0].fit).not.toBe(m().elements[1].fit)
  expect(m().elements[0].source).not.toBe(m().elements[1].source)
  await undo();expect(m().elements.map(e=>e.id)).toEqual([1,2])
  await redo();expect(m().elements.map(e=>e.id)).toEqual([1,2,3])
 })
 it('renames without changing geometry, rejects blank names and preserves undo',async()=>{
  const fit=m().elements[0].fit
  expect(renameCoreObject('element',1,'  Datum A  ')).toBe(true)
  expect(m().elements[0].name).toBe('Datum A')
  expect(m().elements[0].fit).toBe(fit)
  expect(renameCoreObject('element',1,' ')).toBe(false)
  await undo();expect(m().elements[0].name).toBe('Plane 1')
  await redo();expect(m().elements[0].name).toBe('Datum A')
 })
 it('blocks object mutations while an alignment is being edited',()=>{
  m().startAlignment()
  expect(duplicateCoreElement(1)).toBeNull()
  expect(renameCoreObject('element',1,'Wrong')).toBe(false)
  expect(m().elements[0].name).toBe('Plane 1')
 })
 it('only handles unmodified Delete outside editable controls and never repeats',()=>{
  expect(objectDeleteKey('Delete',false,false,false)).toBe(true)
  expect(objectDeleteKey('Delete',true,false,false)).toBe(false)
  expect(objectDeleteKey('Delete',false,true,false)).toBe(false)
  expect(objectDeleteKey('Delete',false,false,true)).toBe(false)
  expect(objectDeleteKey('Backspace',false,false,false)).toBe(false)
 })
})
