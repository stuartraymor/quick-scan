// SPDX-License-Identifier: AGPL-3.0-only
// Real setup writes into fake home folders, real browser consent and real MCP.
import { createRequire } from 'node:module'
import { mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join,resolve,sep } from 'node:path'
import { check,click,finish,launchApp,freePort,sleep,shotPath } from './e2e-lib.mjs'
import { startAgent } from '../mcp/tests/client.js'
const require=createRequire(import.meta.url), native=require('../agent-setup.cjs')
const home=mkdtempSync(join(tmpdir(),'quickscan-agent-e2e-')),appData=join(home,'roaming'),port=await freePort()
const options={home,appData,documents:join(home,'Documents'),env:{APPDATA:appData,SCANRULER_MCP_PORT:String(port)}}
mkdirSync(join(home,'.claude'));mkdirSync(join(home,'.codex'));mkdirSync(join(appData,'Claude'),{recursive:true})
writeFileSync(join(home,'.claude.json'),'{"mcpServers":{"other":{"command":"keep"}}}')
writeFileSync(join(home,'.codex','config.toml'),'model="user-choice"\n')
let agent=null,browser=null,page=null,consoleErrors=[]
try {
 ({browser,page,consoleErrors}=await launchApp({agentDataOk:false,width:1200,height:820}))
 await page.exposeFunction('__nativeAgentSetup',()=>native.setup(options))
 await page.exposeFunction('__nativeAgentRemembered',()=>native.remembered(options))
 await page.exposeFunction('__nativeAgentRemember',state=>native.remember(state,options))
 await page.evaluateOnNewDocument(()=>{
  window.quickScanAgent={setup:()=>window.__nativeAgentSetup(),remembered:()=>window.__nativeAgentRemembered(),remember:state=>window.__nativeAgentRemember(state)}
 })
 await page.reload({waitUntil:'networkidle0'})
 await click(page,'[data-test=ribbon-tab-ai]')
 await click(page,'[data-test=ribbon-rebuild-with-ai]')
 await click(page,'[data-test=ai-setup]')
 await page.waitForSelector('[data-test=ai-setup-results]')
 check(await page.$$eval('[data-test=ai-setup-results] p',p=>p.filter(e=>e.textContent.includes('✓')).length)===3,'one setup click configures all three installed apps')
 const code=JSON.parse(readFileSync(join(home,'.claude.json'),'utf8'))
 check(code.mcpServers.other.command==='keep','other JSON connectors survive setup')
 check(readFileSync(join(home,'.codex','config.toml'),'utf8').includes('model="user-choice"'),'other Codex settings survive setup')
 check(readFileSync(join(home,'.codex','config.toml'),'utf8').includes('tool_timeout_sec = 300'),'Codex tool timeout configured')
 await page.waitForSelector('[data-test=agent-data-warning]')
 check(await page.$('[data-test=agent-chip]')===null,'setup does not bypass data consent')
 check(native.remembered(options)===null,'unaccepted consent is not saved as accepted')
 await click(page,'[data-test=agent-data-accept]')
 await sleep(11000)
 check(await page.$eval('[data-test=ai-status]',e=>e.textContent.includes("isn't running")),'waiting gives an actionable reason after ten seconds')
 await page.screenshot({path:shotPath('ai-setup-waiting.png')})
 agent=await startAgent({args:['--port',String(port),'--no-update','--app',process.env.APP_URL??'http://127.0.0.1:5203/'],env:{APPDATA:appData,SCANRULER_MCP_CONFIG_DIR:join(appData,'scanruler-mcp')},stderr:'pipe'})
 const waited=await agent.call('scanruler_wait',{for:'page',timeoutSeconds:30})
 check(waited.json?.connected===true,'real connector connects using setup pairing without opening Settings')
 const state=await agent.call('session_state')
 check(!state.error,'the connected AI can read the actual Quick Scan session')
 await page.waitForFunction(()=>document.querySelector('[data-test=agent-chip]')?.textContent.includes('connected'))
 await page.screenshot({path:shotPath('ai-setup-connected.png')})
 check(native.remembered(options)?.enabled===true,'accepted connection is saved outside the version profile')
 await click(page,'[data-test=ai-wizard-close]')
 await page.evaluate(()=>localStorage.clear())
 await page.reload({waitUntil:'networkidle0'})
 await page.waitForFunction(()=>document.querySelector('[data-test=agent-chip]')?.textContent.includes('connected'),{timeout:30000})
 check(await page.$('[data-test=agent-data-warning]')===null,'a new version profile restores only previously recorded consent and connects')
 await page.evaluate(async()=>{const p=await import('/src/state/prefsStore.ts');p.usePrefs.getState().setAgentLink(false)})
 await sleep(300)
 check(native.remembered(options)?.enabled===false,'disconnect remains off across versions')
 await page.evaluate(()=>localStorage.clear())
 await page.reload({waitUntil:'networkidle0'})
 check(await page.$('[data-test=agent-chip]')===null,'new profile respects the recorded off choice')
 await click(page,'[data-test=ribbon-tab-ai]');await click(page,'[data-test=ribbon-rebuild-with-ai]')
 await page.evaluate(async()=>{const m=await import('/src/state/prefsStore.ts');m.usePrefs.getState().setAgentToken('incorrect-test-token');m.usePrefs.getState().setAgentLink(true)})
 await page.waitForFunction(()=>document.querySelector('[data-test=ai-status]')?.textContent.includes('refused'),{timeout:15000})
 check(await page.$eval('[data-test=ai-status]',e=>/pairing token/i.test(e.textContent)),'a real token mismatch gives pairing/setup guidance')
 await page.screenshot({path:shotPath('ai-setup-refused.png')})
 await click(page,'[data-test=ai-setup]')
 await page.waitForFunction(()=>document.querySelector('[data-test=agent-chip]')?.textContent.includes('connected'),{timeout:15000})
 check(true,'rerunning setup repairs the real pairing mismatch')
 const expected=consoleErrors.filter(e=>e.includes(`ws://127.0.0.1:${port}/`)&&e.includes('net::ERR_CONNECTION_REFUSED'))
 console.log('Expected browser connection errors while connector deliberately stopped:',expected.length)
 consoleErrors.splice(0,consoleErrors.length,...consoleErrors.filter(e=>!expected.includes(e)))
 await finish(browser,consoleErrors);browser=null
} finally {
 if(agent)await agent.close()
 if(browser)await browser.close()
 if(!resolve(home).startsWith(resolve(tmpdir())+sep+'quickscan-agent-e2e-'))throw Error('Unsafe fixture cleanup')
 rmSync(home,{recursive:true,force:true})
}
