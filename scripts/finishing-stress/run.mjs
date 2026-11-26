import fs from 'node:fs'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'

const here=path.dirname(fileURLToPath(import.meta.url))
const projectRoot=path.resolve(here,'../..')
const config=path.join(projectRoot,'quick-scan.project.json')
const src=fs.existsSync(config)?JSON.parse(fs.readFileSync(config)).sourceRoot:projectRoot
const require=createRequire(path.join(src,'package.json'))
const [directory,partCount='512',workerCount='6']=process.argv.slice(2)
if(!directory)throw Error('Supply a new results directory.')
const count=Number(partCount), workers=Math.min(count,Number(workerCount))
if(!Number.isInteger(count)||count<1||count>512||!Number.isInteger(workers)||workers<1)throw Error('Invalid part or worker count')
const out=path.resolve(directory)
fs.mkdirSync(out)
fs.mkdirSync(path.join(out,'parts'))
const temporary=fs.mkdtempSync(path.join(src,'node_modules/.finishing-stress-'))
const module=path.join(temporary,'campaign.mjs')
try{
  await require('esbuild').build({entryPoints:[path.join(here,'campaign.ts')],outfile:module,bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@source':src}})
  const statuses=await Promise.all(Array.from({length:workers},(_,i)=>new Promise((resolve,reject)=>{
    const log=fs.openSync(path.join(out,'worker-'+i+'.log'),'wx')
    const child=spawn(process.execPath,[module,out,i,workers,count],{stdio:['ignore',log,log],windowsHide:true})
    child.once('error',reject)
    child.once('close',code=>{fs.closeSync(log);resolve(code)})
  })))
  const rows=Array.from({length:workers},(_,i)=>fs.readFileSync(path.join(out,'worker-'+i+'.jsonl'),'utf8')
    .split('\n').filter(Boolean).map(s=>JSON.parse(s))).flat()
  const times=rows.filter(r=>r.ok).map(r=>r.previewMs).sort((a,b)=>a-b)
  const ids=new Set(rows.map(r=>r.id+'/'+r.j)), models=new Set(rows.map(r=>r.id))
  const passed=rows.filter(r=>r.ok), failures=rows.filter(r=>!r.ok)
  const ok=statuses.every(c=>c===0)&&ids.size===count*50&&rows.length===ids.size&&models.size===count&&!failures.length
  const counts={}
  for(const r of rows){const key=['individual corner','individual corner','bore lip','disconnected pair','asymmetric corner'][r.group]+' '+r.kind
    const entry=counts[key]??={executed:0,passed:0};entry.executed++;if(r.ok)entry.passed++}
  const summary={version:require('./package.json').version,ok,models:models.size,executed:rows.length,passed:passed.length,failures:failures.length,
    stepReopens:passed.filter(r=>r.exchange).length,counts,statuses,
    previewMs:{median:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)],max:times.at(-1)},
    maxVolumeError:Math.max(...passed.map(r=>r.volumeError)),maxClearanceError:Math.max(...passed.map(r=>r.clearanceError))}
  fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2))
  console.log(summary)
  if(!ok)process.exitCode=1
}finally{
  if(fs.existsSync(module))fs.unlinkSync(module)
  fs.rmdirSync(temporary)
}
