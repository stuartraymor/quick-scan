// SPDX-License-Identifier: AGPL-3.0-only
import {useStore} from '../state/store'
import {historyAction, historyBlocked} from '../state/historyStore'
import {useDocumentOrder} from '../state/documentOrderStore'
import {commandRunning, pluginBusy} from '../commands/activity'
import {fmtLen, unitWord} from '../core/units'
import {usePrefs} from '../state/prefsStore'

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
  // QUICKSURFACE names a duplicate "<name> - Copy".
  let name=`${item.name} - Copy`, n=2
  while(names.has(name)) name=`${item.name} - Copy (${n++})`
  const copy={...structuredClone(item),id:next,name,visible:true}
  historyAction('Duplicate element',()=>useStore.setState({elements:[...s.elements,copy],nextId:next+1}))
  return next
}

/** "Flip" (QUICKSURFACE): a plane turned over, its normal and what is
 *  built on it the other way round. One undo step. */
export function flipCoreElement(id:number): boolean {
  const s=useStore.getState(), item=s.elements.find(e=>e.id===id)
  if(!item || item.kind!=='plane' || !item.fit || mutationBlocked() || s.busy || s.draft || s.alignDraft || s.sectionDraft || s.dimDraft) return false
  historyAction('Flip',()=>useStore.getState().flipElement(id))
  return true
}

/** "Lock" / "Unlock" (QUICKSURFACE): a locked element cannot be moved
 *  (Edit is refused) but keeps every other command. One undo step. */
export function lockCoreElement(id:number,locked:boolean): boolean {
  const s=useStore.getState(), item=s.elements.find(e=>e.id===id)
  if(!item || Boolean(item.locked)===locked || mutationBlocked() || s.busy || s.draft || s.alignDraft || s.sectionDraft || s.dimDraft) return false
  historyAction(locked?'Lock':'Unlock',()=>useStore.getState().setElementLocked(id,locked))
  return true
}

/** "Color ...": an element's or a section's colour, one undo step. */
export function recolorCoreObject(kind:'element'|'section',id:number,color:string): boolean {
  const s=useStore.getState()
  if(!/^#[0-9a-f]{6}$/i.test(color) || mutationBlocked() || s.busy || s.draft || s.alignDraft || s.sectionDraft || s.dimDraft) return false
  const items=kind==='element'?s.elements:s.sections
  const item=items.find(e=>e.id===id)
  if(!item || item.color.toLowerCase()===color.toLowerCase()) return false
  historyAction('Change color',()=>useStore.setState(kind==='element'
    ? {elements:s.elements.map(e=>e.id===id?{...e,color}:e)}
    : {sections:s.sections.map(e=>e.id===id?{...e,color}:e)}))
  return true
}

const num=(v:number)=>Number.isFinite(v)?String(Number(v.toFixed(4))):'—'
const vec=(v:readonly number[])=>`(${v.map(num).join(', ')})`
// Lengths read in the units chosen in Settings; directions, counts and
// angles are not lengths and stay as they are.
const units=()=>usePrefs.getState().units
const notLength=(key:string)=>/normal|axis|basis|dir|used|count|region|points|angle/i.test(key)
const len=(v:number)=>Number.isFinite(v)?fmtLen(v,units(),4):'—'
const lenVec=(v:readonly number[])=>`(${v.map(x=>Number.isFinite(x)?fmtLen(x,units(),4,{bare:true}):'—').join(', ')}) ${unitWord(units())}`
const words=(key:string)=>key.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,c=>c.toUpperCase())

/** Properties of an element: what it is, how it was made and its geometry,
 *  lengths in the display units. */
export function elementProperties(id:number): (readonly [string,string])[] {
  const s=useStore.getState(), el=s.elements.find(e=>e.id===id) ?? useDocumentOrder.getState().coreArchive?.elements.find(e=>e.id===id)
  if(!el) return []
  const src=el.source
  const name=(ref:number)=>[...s.elements,...s.sections].find(e=>e.id===ref)?.name ?? `#${ref} (missing)`
  const rows:(readonly [string,string])[]=[
    ['Name',el.name],['Type',words(el.kind)],
    ['Made by',src.type==='fitted'?`Fitted (${src.settings.method})`:src.type==='picked'?'Picked':`Constructed (${src.method})`],
  ]
  if(src.type==='constructed' && src.refs.length) rows.push(['Built on',src.refs.map(name).join(', ')])
  if(src.type==='fitted' && src.selection) rows.push(['Marked points',src.selection.length.toLocaleString()])
  if(el.orient) rows.push(['Oriented to',name(el.orient.ref)])
  for(const [key,value] of Object.entries(el.fit ?? {})){
    if(key==='kind') continue
    if(typeof value==='number') rows.push([words(key),notLength(key)?num(value):len(value)])
    else if(Array.isArray(value) && value.length<=3 && value.every(v=>typeof v==='number')) rows.push([words(key),notLength(key)?vec(value as number[]):lenVec(value as number[])])
  }
  if(el.assumed!==undefined) rows.push(['Assumed diameter',len(el.assumed)])
  if(el.message) rows.push(['Status',el.message])
  else if(!el.fit) rows.push(['Status',el.status==='fitting'?'Fitting':'No geometry'])
  return rows
}

export function sectionProperties(id:number): (readonly [string,string])[] {
  const s=useStore.getState(), sec=s.sections.find(e=>e.id===id) ?? useDocumentOrder.getState().coreArchive?.sections.find(e=>e.id===id)
  if(!sec) return []
  return [
    ['Name',sec.name],['Type',sec.kind==='shadow'?'Shadow section':'Section'],
    ['Offset',len(sec.offset)],['Origin',lenVec(sec.frame.origin)],['Normal',vec(sec.frame.normal)],
    ['Chains',sec.cut?String(sec.cut.offsets.length-1):'—'],
    ...(sec.message?[['Status',sec.message] as const]:[]),
  ]
}

export function objectDeleteKey(key:string, editable:boolean, modified:boolean, repeat:boolean):boolean {
  return key==='Delete' && !editable && !modified && !repeat
}
