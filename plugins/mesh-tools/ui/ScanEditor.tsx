// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useShell } from '../../../src/state/shellStore'
import { useMark } from '../../../src/state/markStore'
import { ExtractIcon, type ExtractIconName } from '../../../src/ui/ExtractIcon'
import { meshHotkeys } from '../app/meshHotkeys'
import { EditScanSelection } from './EditScanSelection'
import { EditScanExtras } from './EditScanExtras'
import { useMeshHealth } from './MeshHealth'
import './scan-editor.css'

type Props = {
  busy: boolean
  boundaries: () => void
  createMesh: (cut: boolean) => void
  remove: () => void
  inspect: (name: 'islands' | 'holes' | 'boundaries' | 'boolean') => void
}
export function ScanEditor({busy,boundaries,createMesh,remove,inspect}: Props) {
  const health = useMeshHealth(busy)
  const step = useShell(s => s.prepareStep)
  const count = useMark(s => s.count)
  const gesture = useMark(s => s.gesture)
  const enabled = useMark(s => s.quickTools)
  const [pick, setPick] = useState<{x:number;y:number} | null>(null)
  useEffect(() => {
    const dismiss = (e: PointerEvent) => {
      if ((e.target as Element)?.closest('.viewport')) setPick(null)
    }
    const picked = (e: Event) => setPick((e as CustomEvent<{x:number;y:number}>).detail)
    window.addEventListener('pointerdown',dismiss,true)
    window.addEventListener('scanruler:wand-pick',picked)
    return () => { window.removeEventListener('pointerdown',dismiss,true);window.removeEventListener('scanruler:wand-pick',picked) }
  }, [])
  useEffect(() => { if (!count || !enabled || gesture !== 'wand') setPick(null) }, [count,enabled,gesture])
  const actions: [ExtractIconName,string,()=>void][] = [
    ['remove','Delete selected',remove], ['erase','Defeature selected area',()=>meshHotkeys.defeature?.()],
    ['smooth','Smooth selected',()=>meshHotkeys.smooth?.()], ['hide','Hide selected',()=>meshHotkeys.hide?.('selected')],
    ['invert','Invert selection',()=>useMark.getState().invert()], ['isolate','Isolate',()=>meshHotkeys.hide?.('unselected')],
  ]
  const stage=document.querySelector('.stage')
  const ratio=window.devicePixelRatio || 1
  return <aside className="scan-editor" data-test="edit-scan-dialog">
    <div className="scan-diagnostics">
      {([
        ['Individual meshes',health?.meshes,()=>inspect('islands'),!health?.meshes],
        ['Holes',health?.boundaries,()=>inspect('holes'),!health?.boundaries],
        ['Boundaries',null,()=>inspect('boundaries'),!health?.boundaries],
        ['Duplicate triangles',health?.duplicates,()=>meshHotkeys.removeDuplicates?.(),!health?.duplicates],
      ] as const).map(([label,value,run,disabled],i) => <div key={label} data-test={`mesh-health-${['meshes','holes','boundaries','duplicates'][i]}`}>
        <span>{label}</span><output className={i === 0 && Number(value)>1 ? 'scan-warning' : ''}>{value ?? (i === 2 ? '' : '…')}</output>
        <button onClick={run} disabled={busy || disabled}>{i===3 ? 'Remove' : 'Edit ...'}</button>
      </div>)}
    </div>
    <EditScanSelection busy={busy} onBoundaries={boundaries}/>
    <EditScanExtras busy={busy} createMesh={createMesh} split={()=>inspect('boolean')}/>
    {step===0 && stage && createPortal(<div className="scan-guide" data-test="prepare-banner" role="status">
      <strong>Mesh quality</strong><p>{health ? `The mesh has ${health.meshes} separated meshes and ${health.boundaries} hole(s).` : 'Checking the mesh…'} Use mesh editing tools to improve and create watertight mesh.<br/>Check the number of meshes and holes.</p>
      <p>(Leave the wizard by clicking on the Close [x] button of the control dialog or press Next to move to the next step)</p>
    </div>,stage)}
    {pick && enabled && count>0 && gesture==='wand' && createPortal(<div role="toolbar" aria-label="Quick tools" className="scan-quick" data-test="edit-scan-quick"
      style={{left:pick.x-186/ratio,top:pick.y-119/ratio,transform:`scale(${1/ratio})`}}>
      <span aria-hidden="true"/>{actions.map(([icon,label,run])=><button key={label} title={label} aria-label={label} disabled={busy}
        onClick={()=>{if(icon!=='smooth' && icon!=='invert') setPick(null);run()}}><ExtractIcon name={icon} size={24}/></button>)}
    </div>,document.body)}
  </aside>
}
