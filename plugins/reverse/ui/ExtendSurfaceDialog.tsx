// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { useLength } from '../../../src/app/useUnits'
import { useLengthDraft } from '../../../src/app/useLengthDraft'
import { reverseSession } from '../app/reSession'
import { EXTEND_SAMPLES, EXTEND_SIDES, EXTEND_TYPES, type ExtendSide, type ExtendType } from '../core/extend'
import { bodyColor, useReverse } from '../state/reStore'
import { reSceneOf } from '../viewer/reScene'

export const useExtendDialog=create<{open:boolean;setOpen:(open:boolean)=>void}>(set=>({open:false,setOpen:open=>set({open})}))

export function ExtendSurfaceDialog() {
  const bodies=useReverse(s=>s.bodies)
  const sheets=bodies.filter(b=>b.surface)
  const [sheet,setSheet]=useState(sheets.find(b=>b.visible)?.id ?? sheets[0]?.id)
  const [type,setType]=useState<ExtendType>('natural')
  const [sides,setSides]=useState<ExtendSide[]>([...EXTEND_SIDES])
  const [text,setText,offset]=useLengthDraft(1)
  const [ready,setReady]=useState('')
  const [issue,setIssue]=useState('')
  const length=useLength()
  const key=JSON.stringify([sheet,offset,type,sides])
  const close=()=>useExtendDialog.getState().setOpen(false)
  useEffect(()=>{
    let active=true
    const session=reverseSession(), client=session?.client(), viewport=session?.sceneRef.current
    const scene=viewport ? reSceneOf(viewport) : null
    setReady('');setIssue('')
    if (!sheet || !(offset>0) || !sides.length || !client) return
    const timer=setTimeout(async()=>{
      try {
        const result=await client.preview({id:-1,kind:'extend',name:'Preview',sheet,offset,sides,type,samples:EXTEND_SAMPLES},undefined)
        if(!active || !result)return
        scene?.setBodyPreview(result.mesh,bodyColor(sheet),{replaces:[sheet],edges:true});setReady(key)
      } catch(error) { if(active)setIssue(error instanceof Error ? error.message : String(error)) }
    },160)
    return ()=>{active=false;clearTimeout(timer);scene?.setBodyPreview(null,'#ffffff')}
  },[sheet,offset,sides,type,key])
  return <div className="modalback" data-test="extend-dialog" onKeyDown={e=>{if(e.key==='Escape')close()}}>
    <form className="modal" style={{width:300,display:'grid',gap:8,padding:14}} onSubmit={e=>{
      e.preventDefault()
      if(ready===key && sheet){useReverse.getState().addExtend({sheet,offset,sides,type,samples:EXTEND_SAMPLES});close()}
    }}>
      <header>Extend Surface</header>
      <label>Sheet <select value={sheet??''} onChange={e=>setSheet(Number(e.target.value))}>{sheets.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label>Extend type <select value={type} onChange={e=>setType(e.target.value as ExtendType)}>{EXTEND_TYPES.map(t=><option key={t} value={t}>{t}</option>)}</select></label>
      <label>Offset ({length.word()}) <input type="number" step="any" value={text} onChange={e=>setText(e.target.value)} /></label>
      <fieldset><legend>Patch edges</legend>{EXTEND_SIDES.map(side=><label key={side}><input type="checkbox" checked={sides.includes(side)} onChange={e=>setSides(e.target.checked?[...sides,side]:sides.filter(s=>s!==side))}/>{side.toUpperCase()} </label>)}</fieldset>
      {issue && <small role="alert">{issue}</small>}
      <footer><button type="button" onClick={close}>Cancel</button> <button disabled={ready!==key}>Create extension</button></footer>
    </form>
  </div>
}
