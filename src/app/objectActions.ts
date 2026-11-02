// SPDX-License-Identifier: AGPL-3.0-only
import {useStore} from '../state/store'
import {historyAction, historyBlocked} from '../state/historyStore'
import {useDocumentOrder} from '../state/documentOrderStore'
import {commandRunning, pluginBusy} from '../commands/activity'

function mutationBlocked(): boolean {
  return historyBlocked() || commandRunning() || pluginBusy() !== null || useDocumentOrder.getState().rollbackAt !== null
}

export function renameCoreObject(kind:'element'|'section',id:number,name:string): boolean {
  const clean=name.trim(), s=useStore.getState()
  if(!clean || mutationBlocked() || s.busy || s.draft || s.alignDraft || s.sectionDraft || s.dimDraft) return false
  const items=kind==='element'?s.elements:s.sections
  if(!items.some(e=>e.id===id)) return false
  historyAction('Rename object',()=>useStore.setState(kind==='element'
    ? {elements:s.elements.map(e=>e.id===id?{...e,name:clean}:e)}
    : {sections:s.sections.map(e=>e.id===id?{...e,name:clean}:e)}))
  return true
}

export function duplicateCoreElement(id:number):number|null {
  const s=useStore.getState(), item=s.elements.find(e=>e.id===id)
  if(!item || !item.fit || mutationBlocked() || s.busy || s.draft || s.alignDraft || s.sectionDraft || s.dimDraft) return null
  const next=[...s.elements,...s.sections].reduce((next,item)=>Math.max(next,item.id+1),s.nextId)
  const names=new Set(s.elements.map(e=>e.name))
  let name=`${item.name} copy`, n=2
  while(names.has(name)) name=`${item.name} copy ${n++}`
  const copy={...structuredClone(item),id:next,name,visible:true}
  historyAction('Duplicate element',()=>useStore.setState({elements:[...s.elements,copy],nextId:next+1}))
  return next
}

export function objectDeleteKey(key:string, editable:boolean, modified:boolean, repeat:boolean):boolean {
  return key==='Delete' && !editable && !modified && !repeat
}
