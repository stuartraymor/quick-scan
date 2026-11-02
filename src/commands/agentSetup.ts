// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react'
import { usePrefs } from '../state/prefsStore'
import { AGENT_STATUS, useAgentLink } from './agentLink'

export interface AgentAppResult { app: string; status: 'added'|'updated'|'not-installed'|'error'; detail: string }
export interface AgentSetupResult { port: number; token: string; apps: AgentAppResult[] }
export interface AgentSetupBridge {
 setup: () => Promise<AgentSetupResult>
 remembered: () => Promise<({enabled:boolean;consent:true;port:number;token:string})|null>
 remember: (state:{enabled:boolean;consent:boolean}) => Promise<boolean>
}
export const agentSetupBridge = (): AgentSetupBridge|undefined => typeof window === 'undefined' ? undefined : (window as unknown as {quickScanAgent?:AgentSetupBridge}).quickScanAgent

export function useAgentConnectionHint(): string {
 const link=useAgentLink(), [waiting,setWaiting]=useState(false)
 useEffect(()=>{setWaiting(false);if(link.status!=='waiting')return;const id=window.setTimeout(()=>setWaiting(true),10000);return()=>window.clearTimeout(id)},[link.status])
 if(link.status==='refused')return `The connector refused the connection. The pairing token may not match, or another Quick Scan window is connected${link.detail?`: ${link.detail}`:'.'} Run Set up my AI app, then restart your AI app.`
 if(link.status==='waiting'&&waiting)return "Your AI app isn't running the Quick Scan connector. Restart it (quit fully; on Windows check the tray), or click Set up my AI app again."
 return AGENT_STATUS[link.status]+(link.detail?` — ${link.detail}`:'')
}

/** Persist only recorded user consent and the on/off choice across versioned
 * Electron profiles. Restore pairing from the connector's own private file.
 * This never accepts a consent warning on an unconsented installation. */
export async function installDesktopAgentPersistence(): Promise<()=>void> {
 const bridge=agentSetupBridge()
 if(!bridge)return()=>{}
 try {
  const existing=localStorage.getItem('scanruler.agentlink')!==null
  const saved=await bridge.remembered()
  if(!existing&&saved?.consent===true){
   const prefs=usePrefs.getState()
   prefs.setAgentPort(saved.port);prefs.setAgentToken(saved.token)
   prefs.answerAgentData(true)
   if(!saved.enabled)prefs.setAgentLink(false)
  }
 } catch { /* An unavailable native record never opts the user into data sharing. */ }
 let previous=''
 const push=()=>{
  const s=usePrefs.getState(), key=`${s.agentLink}:${s.agentDataOk}`
  if(key===previous)return;previous=key
  void bridge.remember({enabled:s.agentLink,consent:s.agentDataOk}).catch(()=>{})
 }
 push()
 return usePrefs.subscribe((s,old)=>{if(s.agentLink!==old.agentLink||s.agentDataOk!==old.agentDataOk)push()})
}
