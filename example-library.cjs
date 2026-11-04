// SPDX-License-Identifier: AGPL-3.0-only
// Only enumerate folders selected by the user. The renderer gets menu labels
// and opaque keys; it never supplies a filesystem path to the read endpoint.
const fs=require('node:fs/promises'), path=require('node:path'), crypto=require('node:crypto')
const ext=/\.(?:stl|obj|ply|3mf)$/i
const norm=s=>s.normalize('NFKC').toLowerCase().replace(/[\s_-]/g,'')
const keyFor=(root,rel)=>crypto.createHash('sha256').update(root+'\0'+rel).digest('hex')
async function indexFolder(folder,catalog){
 const root=await fs.realpath(folder),queue=[''],entries=[],byKey=new Map()
 let truncated=false
 for(let q=0;q<queue.length;q++){
   let ls
   try{ls=await fs.readdir(path.join(root,queue[q]),{withFileTypes:true})}catch(e){if(!q)throw e;continue}
   ls.sort((a,b)=>a.name.localeCompare(b.name,'en'))
   for(const item of ls){
    if(item.name.startsWith('.')||item.isSymbolicLink())continue
    const rel=path.join(queue[q],item.name)
    if(item.isDirectory()){if(queue.length<2048)queue.push(rel);else truncated=true;continue}
    if(!item.isFile()||!ext.test(item.name))continue
    if(entries.length===4096){truncated=true;break}
    const key=keyFor(root,rel),entry={key,file:item.name,label:rel.split(path.sep).join('/')}
    entries.push(entry);byKey.set(key,rel)
   }
   if(entries.length===4096){truncated=true;break}
 }
 // Exact catalog file anywhere wins; a uniquely named file or a single
 // model inside a like-named folder is a personal example, not a vendor copy.
 const slots={}
 for(const c of catalog){
   const aliases=[norm(path.parse(c.file).name),norm(c.label)]
   const exact=entries.filter(e=>e.file.toLowerCase()===c.file)
   const pick=(rows)=>rows.length===1?rows[0]:undefined
   const direct=exact.find(e=>e.label===e.file)
   const original=direct||pick(exact)
   if(original){slots[c.id]={...original,verify:(await fs.stat(path.join(root,original.label))).size===c.bytes};continue}
   const named=entries.filter(e=>aliases.includes(norm(path.parse(e.file).name)))
   const inside=entries.filter(e=>e.label.split('/').slice(0,-1).some(p=>aliases.includes(norm(p))))
   const local=pick(named) || (!named.length && pick(inside))
   if(local)slots[c.id]={...local,verify:false}
 }
 return {root,entries,slots,byKey,truncated}
}
async function resolveKey(index,key){
 const rel=index?.byKey.get(key);if(!rel)return null
 const file=await fs.realpath(path.join(index.root,rel)),within=path.relative(index.root,file)
 if(!within||within.startsWith('..'+path.sep)||within==='..'||path.isAbsolute(within)||!ext.test(file))return null
 return (await fs.stat(file)).isFile()?file:null
}
module.exports={indexFolder,resolveKey}
