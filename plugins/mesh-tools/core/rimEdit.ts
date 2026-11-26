// SPDX-License-Identifier: AGPL-3.0-only
import { boundaryLoops } from './boundary'
import { compactEdit, type EditedMesh } from './edit'

export type RimOperation =
  | { action:'smooth'; starts:number[]; anchors:number[]; strength:number }
  | { action:'expand'; start:number }
  | { action:'semi'|'zip'; ends:[number,number]; anchors?:number[] }
  | { action:'bridge'; first:[number,number]; second:[number,number]; side:number }

function arc(ring: Uint32Array, start:number, end:number, direction:number):number[] {
  const at=ring.indexOf(start)
  if(at<0 || !ring.includes(end) || start===end) throw Error('Choose distinct points on the same rim.')
  const path=[start]
  for(let n=1;n<ring.length;n++){
    const v=ring[(at+n*direction+ring.length)%ring.length]
    path.push(v)
    if(v===end) break
  }
  return path
}

export function editRims(points:Float32Array, indices:Uint32Array, count:number, op:RimOperation):EditedMesh {
  const loops=boundaryLoops(indices,count).loops.map(l=>l.vertices)
  const owner=(v:number)=>{
    const matches=loops.filter(r=>r.includes(v))
    if(matches.length!==1)throw Error('Pick a point on one unambiguous open rim.')
    return matches[0]
  }
  const next=(ring:Uint32Array,v:number,step:number)=>ring[(ring.indexOf(v)+step+ring.length)%ring.length]
  const positions=points.slice(0,count*3)
  const identity=Int32Array.from({length:count},(_,i)=>i)
  if(op.action==='smooth'){
    const fixed=new Set(op.anchors)
    const rings=[...new Set(op.starts.map(owner))]
    if(!rings.length || !Number.isInteger(op.strength) || op.strength<1 || op.strength>10)throw Error('Select a rim and a valid smoothing strength.')
    for(let n=0;n<op.strength;n++){
      const before=positions.slice()
      for(const ring of rings)ring.forEach((v,i)=>{
        if(fixed.has(v))return
        const a=ring[(i+ring.length-1)%ring.length], b=ring[(i+1)%ring.length]
        for(let k=0;k<3;k++)positions[v*3+k]=before[v*3+k]*.5+(before[a*3+k]+before[b*3+k])*.25
      })
    }
    return {positions,indices:indices.slice(),vertexMap:identity}
  }
  if(op.action==='expand'){
    const rim=new Set(owner(op.start)), kept:number[]=[]
    for(let i=0;i<indices.length;i+=3){
      if(!rim.has(indices[i])&&!rim.has(indices[i+1])&&!rim.has(indices[i+2]))kept.push(indices[i],indices[i+1],indices[i+2])
    }
    if(!kept.length)throw Error('Expanding this rim would remove the entire mesh.')
    return compactEdit(positions,Uint32Array.from(kept),count)
  }
  const faces:number[]=[]
  let weld: Map<number,number>|undefined
  if(op.action==='bridge'){
    const [a,b]=op.first,[c,d]=op.second
    const left=owner(a),right=owner(b)
    if(left===right || owner(c)!==left || owner(d)!==right)throw Error('Draw two guides from the same first rim to a second rim.')
    const positive=arc(left,a,c,1),negative=arc(left,a,c,-1)
    const forward=op.side===a || op.side===c ? positive.length<=negative.length : positive.includes(op.side)
    if(!left.includes(op.side))throw Error('Choose the side on the first rim between the guides.')
    const l=forward?positive:negative,r=arc(right,b,d,forward?-1:1)
    const distances=(path:number[])=>{
      const lengths=[0]
      for(let i=1;i<path.length;i++){
        const x=path[i]*3,y=path[i-1]*3
        lengths.push(lengths[i-1]+Math.hypot(positions[x]-positions[y],positions[x+1]-positions[y+1],positions[x+2]-positions[y+2]))
      }
      const total=lengths[lengths.length-1]
      if(!total)throw Error('This guide has zero length.')
      return lengths.map(n=>n/total)
    }
    const u=distances(l),v=distances(r)
    let i=0,j=0
    const add=(a:number,b:number,c:number)=>forward?faces.push(a,b,c):faces.push(c,b,a)
    while(i+1<l.length || j+1<r.length){
      if(j+1===r.length || (i+1<l.length && u[i+1]<=v[j+1])){add(l[i+1],l[i],r[j]);i++}
      else {add(l[i],r[j],r[j+1]);j++}
    }
  }else{
    const [a,b]=op.ends,left=owner(a),right=owner(b)
    if(a===b)throw Error('Choose two different boundary points.')
    const a1=next(left,a,1),b1=next(right,b,1)
    if(op.action==='semi'){
      if(left!==right || new Set([a,a1,b,b1]).size!==4 || next(left,a1,1)===b || next(right,b1,1)===a)
        throw Error('Draw across one hole, leaving at least three edges on each side.')
      faces.push(a1,a,b1, a1,b1,b)
    }else{
      // Pair the first selected vertices and traverse the opposite rim backwards.
      const opposite=next(right,b,-1)
      weld=new Map([[b,a],[opposite,a1]])
      if(new Set([a,a1,b,opposite]).size!==4)throw Error('The seam edges touch already.')
      const fixed=new Set(op.anchors)
      for(const [away,keep] of weld){
        if(fixed.has(away)&&fixed.has(keep))throw Error('Release one of the two anchors before zipping.')
        for(let k=0;k<3;k++)positions[3*keep+k]=fixed.has(keep)?positions[3*keep+k]:fixed.has(away)?positions[3*away+k]:(positions[3*keep+k]+positions[3*away+k])/2
      }
    }
  }
  // Check only the affected edges. Existing scan defects elsewhere do not veto a local repair.
  const changed=new Set<number>(weld?[...weld.values()]:faces)
  const touched=new Map<string,{count:number;balance:number}>(), seen=new Set<string>(), out:number[]=[]
  const append=(a:number,b:number,c:number)=>{
    if(a===b||b===c||a===c)return
    if(changed.has(a)||changed.has(b)||changed.has(c)){
      const key=[a,b,c].sort((x,y)=>x-y).join(',')
      if(seen.has(key))throw Error('The proposed seam duplicates an existing face.')
      seen.add(key)
      const ax=positions[3*b]-positions[3*a],ay=positions[3*b+1]-positions[3*a+1],az=positions[3*b+2]-positions[3*a+2]
      const bx=positions[3*c]-positions[3*a],by=positions[3*c+1]-positions[3*a+1],bz=positions[3*c+2]-positions[3*a+2]
      if(!Math.hypot(ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx))throw Error('The seam contains a zero-area triangle.')
      for(const [v,w] of [[a,b],[b,c],[c,a]]){
        if(!changed.has(v)&&!changed.has(w))continue
        const edge=v<w?v+','+w:w+','+v,rec=touched.get(edge)??{count:0,balance:0}
        rec.count++;rec.balance+=v<w?1:-1;touched.set(edge,rec)
        if(rec.count>2 || (rec.count===2 && rec.balance!==0))throw Error('This seam would overlap or reverse an existing face.')
      }
    }
    out.push(a,b,c)
  }
  for(let i=0;i<indices.length;i+=3)append(weld?.get(indices[i])??indices[i],weld?.get(indices[i+1])??indices[i+1],weld?.get(indices[i+2])??indices[i+2])
  for(let i=0;i<faces.length;i+=3)append(faces[i],faces[i+1],faces[i+2])
  if(!weld)return {positions,indices:Uint32Array.from(out),vertexMap:identity}
  const result=compactEdit(positions,Uint32Array.from(out),count)
  for(const [away,keep] of weld)result.vertexMap[away]=result.vertexMap[keep]
  return result
}
