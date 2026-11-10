// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Vec2 } from '../../../src/core/flat/types'
import { beginSketchAssist } from '../state/sketchAssist'
import { useRePrefs } from '../state/rePrefs'

export function SketchAssistDialog({ chains, onClose }: { chains: readonly Vec2[][]; onClose: () => void }) {
  const transaction = useRef<ReturnType<typeof beginSketchAssist> | null>(null)
  const [detail,setDetail] = useState(useRePrefs.getState().fitOptions.detail)
  const [join,setJoin] = useState(useRePrefs.getState().fitOptions.joinCorners)
  const [error,setError] = useState('')
  const [ready,setReady] = useState(false)
  const [count,setCount] = useState(0)
  const [options,setOptions] = useState(false)
  const preview = () => {
    try {
      const result=transaction.current!.preview({ ...useRePrefs.getState().fitOptions, detail, joinCorners: join })
      setCount(result.sketch.entities.length); setError(result.error ?? ''); setReady(!result.error)
    } catch(e) { setError(e instanceof Error?e.message:String(e));setReady(false) }
  }
  useEffect(() => {
    transaction.current=beginSketchAssist(chains);preview()
    return () => transaction.current?.cancel()
  }, [])
  const cancel=()=>{transaction.current?.cancel();onClose()}
  return createPortal(<div className="modalback" style={{ background:'transparent', alignItems:'flex-start',justifyContent:'flex-start',paddingTop:176,paddingLeft:'min(244px, max(12px, calc(100vw - 350px)))' }}
    onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();cancel()}}}>
    <form className="modal" role="dialog" aria-modal="true" aria-label="Sketch assist" data-test="sketch-assist-dialog" style={{width:330,padding:14,display:'grid',gap:12}}
      onSubmit={e=>{e.preventDefault();e.stopPropagation();if(!ready)return;try{transaction.current?.accept();onClose()}catch(error){setError(error instanceof Error?error.message:String(error));setReady(false)}}}>
      <header>Sketch assist</header><div>All reference chains</div>
      <button autoFocus type="button" onClick={()=>setOptions(v=>!v)}>Options …</button>
      {options&&<fieldset><legend>Fit options</legend>
        <label>Detail <input aria-label="Assist detail" type="range" min="0" max="1" step="0.05" value={detail} onChange={e=>{setDetail(Number(e.target.value));setReady(false)}}/></label>
        <label><input type="checkbox" aria-label="Assist join corners" checked={join} onChange={e=>{setJoin(e.target.checked);setReady(false)}}/> Join corners</label>
      </fieldset>}
      <button type="button" data-test="sketch-assist-preview" disabled={ready} onClick={preview}>Preview</button>
      <small data-test="sketch-assist-count">{count} sketch entities in preview</small>
      {error&&<small role="alert">{error}</small>}
      <footer style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
        <button type="button" onClick={cancel}>Cancel</button>
        <button type="submit" data-test="sketch-assist-accept" disabled={!ready}>Accept</button>
      </footer>
    </form>
  </div>,document.body)
}
