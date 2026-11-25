import fs from 'node:fs'
import path from 'node:path'
import { Builder } from '@source/plugins/reverse/core/build'
import { ReKernel } from '@source/plugins/reverse/core/kernel'
import { polygonLoop } from '@source/plugins/reverse/core/loops'

// Each base-four digit controls a different physical cut (straight,
// V, rectangular or dovetail). The second series adds a fork and extra bore.
// The unequal station spacing keeps mirror images distinguishable.
function profile(id: number) {
  const xy = [[0,0],[54,0],[54,20]]
  for (const [i, right] of [51,39,26,12].entries()) {
    const style = Math.floor(id / 4 ** i) % 4
    const depth = 3 + i * .42
    if (!style) continue
    xy.push([right,20])
    if (style === 1) xy.push([right-3,20-depth])
    else if (style === 2) xy.push([right,20-depth],[right-6,20-depth])
    else xy.push([right+1.25,20-depth],[right-7.25,20-depth])
    xy.push([right-6,20])
  }
  xy.push([0,20])
  if (id >= 256) xy.push([0,15],[8,15],[8,11],[0,11])
  return xy
}

function corner(vertices: number[][], i: number) {
  const p = vertices[i], a = vertices[(i+vertices.length-1)%vertices.length], b = vertices[(i+1)%vertices.length]
  const u = [p[0]-a[0],p[1]-a[1]], v = [b[0]-p[0],b[1]-p[1]]
  const turn = Math.atan2(u[0]*v[1]-u[1]*v[0],u[0]*v[0]+u[1]*v[1])
  return {angle:Math.PI-Math.abs(turn),sign:Math.sign(turn)}
}

const [out, first, stride, limit] = process.argv.slice(2)
const k = await ReKernel.load()
const journal = fs.openSync(path.join(out,'worker-'+first+'.jsonl'),'wx')
const write = row => fs.writeSync(journal,JSON.stringify(row)+'\n')
for (let id=Number(first);id<Number(limit);id+=Number(stride)) {
  const unit = [.25,1,3][id%3], h = (7+(id%17)*.19)*unit
  const xy = profile(id).map(p=>p.map(x=>x*unit)), radius=(1.9+(id%7)*.06)*unit
  const hole = (x,y) => [{kind:'circle',center:[x*unit,y*unit,0],normal:[0,0,1],radius}]
  const holes = [hole(17,6), ...(id>=256?[hole(42,7)]:[])]
  const face = k.face({outer:polygonLoop(xy.map(([x,y])=>[x,y,0])),holes})
  const stock = k.extrude(face,[0,0,1],0,h)
  k.release(face)
  const b = new Builder(k), base = {id:1,kind:'import',name:'Stock',file:'stock'}
  try {
    const file = k.exportStep([stock])
    fs.writeFileSync(path.join(out,'parts',id+'.step'),file)
    b.addStepFiles([['stock',file]])
    const before = b.build([base],()=>undefined,true).bodies[0]
    const edges = before.topology.edges.map(e=>e.fingerprint)
    const axial = xy.map(([x,y])=>edges.find(e=>e.kind==='line' && Math.hypot(e.mid[0]-x,e.mid[1]-y,e.mid[2]-h/2)<1e-5))
    const rims = edges.filter(e=>e.kind==='circle' && Math.abs(e.radius-radius)<1e-6)
    if (axial.some(e=>!e) || rims.length!==2*holes.length) throw Error('Stock edge inventory '+id)
    for (let j=0;j<50;j++) {
      const group = j%5, pass = Math.floor(j/5), d=(.11+.048*pass+.0023*(id%11))*unit
      const d2=d*(.55+.053*(id%9)), angleDeg=28+pass*3
      const kind = group===0?'fillet':group===1||group===4?'chamfer':pass%2?'fillet':'chamfer'
      const varyingIndex = (id+pass+(group===1?5:0))%xy.length
      const indices = group===3?[0,1]:group===4?[0]:[varyingIndex]
      const picked = group===2?[rims[(id+pass)%rims.length]]:indices.map(i=>axial[i])
      const feature = {id:2,body:before.id,kind,name:kind,edges:picked,chain:false,
        ...(kind==='fillet'?{radius:d}:{distance:d}),
        ...(group!==4?{}:pass%2?{mode:'distanceAngle',angleDeg,flip:!!(id%2)}:{mode:'twoDistances',distance2:d2,flip:!!(id%2)})}
      const other = group===4?(pass%2?d*Math.tan(angleDeg*Math.PI/180):d2):d
      let expected=0
      const gaps=[]
      if (group===2) {
        const area=d*d*(kind==='fillet'?1-Math.PI/4:.5)
        const moment=d**3*(kind==='fillet'?5/6-Math.PI/4:1/6)
        expected=2*Math.PI*(radius*area+moment)
        gaps.push(d*(kind==='fillet'?Math.SQRT2-1:1/Math.SQRT2))
      } else for(const i of indices) {
        const {angle,sign}=corner(xy,i)
        expected+=sign*h*(kind==='fillet'?d*d*(1/Math.tan(angle/2)-(Math.PI-angle)/2):d*other*Math.sin(angle)/2)
        gaps.push(kind==='fillet'?d*(1/Math.sin(angle/2)-1):
          d*other*Math.sin(angle)/Math.sqrt(d*d+other*other-2*d*other*Math.cos(angle)))
      }
      const row={id,j,kind,group,dimension:d,expected,gaps,ok:false}
      try {
        const original=b.build([base],()=>undefined,true).bodies[0]
        if(!original.closed||Math.abs(original.volume-before.volume)>1e-6) throw Error('Rollback changed stock')
        const start=performance.now(), preview=b.preview(feature)
        row.previewMs=performance.now()-start
        const commitStart=performance.now(), built=b.build([base,feature],()=>undefined,true)
        row.commitMs=performance.now()-commitStart
        if(!preview.closed||preview.failure||built.results.at(-1)?.status!=='ok'||built.bodies.length!==1)
          throw Error(built.results.at(-1)?.message||'Preview or commit declined')
        const shape=b.bodyById(before.id).shape
        if(!k.isClosedSolid(shape)||k.solidCount(shape)!==1) throw Error('Invalid solid')
        row.volumeError=Math.abs(before.volume-k.volume(shape)-expected)
        const tol=2e-6+Math.abs(expected)*2e-5
        if(row.volumeError>tol||Math.abs(preview.volume-k.volume(shape))>tol) throw Error('Volume disagreement')
        const shells=k.occt.getSubShapes(shape,'shell')
        try {
          if(shells.length!==1) throw Error('Unexpected shell count')
          row.clearanceError=Math.max(...picked.map((e,i)=>Math.abs(k.distanceToPoint(shells[0],e.mid)-gaps[i])))
          if(row.clearanceError>2e-5*unit+1e-6) throw Error('Selected edge clearance disagreement')
        } finally { k.release(...shells) }
        if(j%25===0){
          const reopened=k.importStep(b.exportStep([before.id]))
          try {if(!k.isClosedSolid(reopened)||k.solidCount(reopened)!==1||Math.abs(k.volume(shape)-k.volume(reopened))>tol) throw Error('STEP round trip')}
          finally {k.release(reopened)}
          row.exchange=true
        }
        row.ok=true
      }catch(error){row.error=String(error);row.feature=feature;process.exitCode=1}
      write(row)
    }
  }finally{b.dispose();k.release(stock)}
}
fs.closeSync(journal)
