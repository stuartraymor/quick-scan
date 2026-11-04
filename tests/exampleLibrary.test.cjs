// SPDX-License-Identifier: AGPL-3.0-only
const {test}=require('node:test'), assert=require('node:assert/strict')
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os')
const {indexFolder,resolveKey}=require('../example-library.cjs')
const catalog=require('../src/app/referenceExamples.json')
test('maps unique file and folder names, retains ambiguous personal models, and rejects unknown keys', async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'quickscan-library-'))
 t.after(()=>fs.rm(root,{recursive:true,force:true}))
 for(const f of ['Basic part/custom.obj','misc/Aerosol-Knob.ply','Steel/a.stl','Steel/b.3mf','notes.txt','personal.stl']){
   const target=path.join(root,f);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,'mesh')
 }
 const index=await indexFolder(root,catalog)
 assert.equal(index.entries.length,5);assert.equal(index.slots.basic_part.file,'custom.obj');assert.equal(index.slots.aerosol_knob.file,'Aerosol-Knob.ply')
 assert.equal(index.slots.basic_part.verify,false);assert.equal(index.slots.steel,undefined)
 assert.equal(await resolveKey(index,index.slots.basic_part.key),await fs.realpath(path.join(root,'Basic part/custom.obj')))
 assert.equal(await resolveKey(index,'../notes.txt'),null)
})
