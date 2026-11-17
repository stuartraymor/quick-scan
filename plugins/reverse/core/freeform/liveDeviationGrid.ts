// SPDX-License-Identifier: AGPL-3.0-only
import type { Vec3 } from '../../../../src/core/types'
import { vertexNormals } from './limit'

/** Regular measured charts on the *displayed* evaluated triangles. Cache each
 * cell independently, including across a topology edit which renumbers vertices.
 * No CAD build, distance interpolation, or tolerance-dependent measurement. */
export function liveDeviationGrid() {
  type Tile = { positions: Float32Array; values: Float32Array }
  type Measure = (p: Float32Array) => Float32Array
  let cache = new Map<string, Tile>(), epoch = 0, capacity = 256
  let cells = new WeakMap<readonly number[], { corners: readonly Vec3[]; tile: Tile }>()
  let lastMeasure: Measure | undefined, lastReference: object | undefined
  const prepare = (points: readonly Vec3[], faces: readonly number[][], measure: Measure, reference?: object) => {
    if (measure !== lastMeasure || reference !== lastReference) { cache.clear(); cells = new WeakMap(); epoch++ }
    lastMeasure=measure; lastReference=reference; capacity=Math.max(256,faces.length*3)
    const size=5, count=size*size, tiles:Tile[]=[], pending:{key:string;tile:Tile}[]=[], local=new Map<string,Tile>()
    for (const face of faces) {
      if (face.length !== 4) throw new Error('Live analysis requires evaluated quads.')
      const corners=face.map(v=>points[v]), known=cells.get(face)
      // The evaluator retains unchanged point objects. Avoid coordinate-string
      // allocation and map churn for all stationary cells on every mouse move.
      if (known && corners.every((p,i)=>p.every((v,k)=>v===known.corners[i][k]))) {
        tiles.push(known.tile); continue
      }
      const key=corners.map(p=>p.join(',')).join(';')
      let tile=local.get(key) ?? cache.get(key)
      if (tile) {
        if (cache.has(key)) { cache.delete(key); cache.set(key,tile) }
      } else {
        const positions=new Float32Array(count*3)
        // Every query lies on the displayed triangles, including their 0–2 diagonal.
        for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
          const u=x/(size-1),v=y/(size-1),weights=u>=v?[1-u,u-v,v,0]:[1-v,0,u,v-u]
          for(let a=0;a<3;a++) positions[(y*size+x)*3+a]=corners.reduce((sum,p,k)=>sum+p[a]*weights[k],0)
        }
        tile={positions,values:new Float32Array(count)};pending.push({key,tile})
      }
      local.set(key,tile);tiles.push(tile)
    }
    const queries=new Float32Array(pending.length*count*3)
    pending.forEach(({tile},i)=>queries.set(tile.positions,i*count*3))
    return {tiles,pending,queries,epoch,size,count}
  }
  const fill = (prepared:ReturnType<typeof prepare>,values:Float32Array) => {
    const {pending,count}=prepared
    if(values.length!==pending.length*count) throw new Error('Incomplete live deviation samples.')
    pending.forEach(({tile,key},i)=>{
      tile.values.set(values.subarray(i*count,(i+1)*count))
      // A late worker response for an old reference cannot populate a new scan.
      if(prepared.epoch===epoch) {cache.delete(key);cache.set(key,tile)}
    })
    while(cache.size>capacity) cache.delete(cache.keys().next().value!)
  }
  const sample = (points:readonly Vec3[],faces:readonly number[][],measure:Measure,reference?:object) => {
    const prepared=prepare(points,faces,measure,reference),{tiles,size,count}=prepared
    if(prepared.pending.length) fill(prepared,measure(prepared.queries))
    faces.forEach((face,i)=>{
      if(cells.get(face)?.tile!==tiles[i]) cells.set(face,{corners:face.map(v=>[...points[v]] as Vec3),tile:tiles[i]})
    })
    // Rendering keeps the existing two triangles per cell. The shader samples
    // the dense chart per pixel; adding render triangles would only inflate
    // buffer uploads and normals work without improving the measured colors.
    const smoothNormals = vertexNormals(Float64Array.from(points.flat()), faces as number[][])
    const normals = new Float32Array(tiles.length * 12)
    const positions = new Float32Array(tiles.length * 12), values = new Float32Array(tiles.length * 4)
    const gridValues = new Float32Array(tiles.length * count)
    const coordinates = new Float32Array(positions.length), triangles = new Uint32Array(tiles.length * 6)
    tiles.forEach((tile,f) => {
      gridValues.set(tile.values,f * count)
      const corners = [0,size-1,count-1,count-size]
      corners.forEach((k,j) => {
        positions.set(tile.positions.subarray(k*3,k*3+3),f*12+j*3)
        values[f*4+j] = tile.values[k]
        const v = faces[f][j]
        normals.set(smoothNormals.subarray(v*3,v*3+3),f*12+j*3)
      })
      coordinates.set([0,0,f,1,0,f,1,1,f,0,1,f],f*12)
      const i=f*4;triangles.set([i,i+1,i+2,i,i+2,i+3],f*6)
    })
    return { positions, normals, values, triangles, statisticsValues:gridValues, grid: { coordinates, values:gridValues, size, faces: tiles.length } }
  }
  return Object.assign(sample, {
    /** Worker preparation changes only the exact-coordinate cache, never the
     * visible field. A gesture that starts earlier still measures synchronously. */
    async warm(points:readonly Vec3[],faces:readonly number[][],measure:Measure,reference:object|undefined,asyncMeasure:(p:Float32Array)=>Promise<Float32Array>) {
      const prepared=prepare(points,faces,measure,reference)
      if(prepared.pending.length) fill(prepared,await asyncMeasure(prepared.queries))
    },
    clear() { cache.clear();cells=new WeakMap();epoch++;lastMeasure=undefined;lastReference=undefined },
  })
}
