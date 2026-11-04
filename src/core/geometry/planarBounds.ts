// SPDX-License-Identifier: AGPL-3.0-only
/** The convex hull of flattened x,y points, counter-clockwise, collinear
 *  points dropped (Andrew's monotone chain). */
export function convexHull(points: ArrayLike<number>): Float64Array {
  const n = points.length >> 1
  const order = Array.from({ length: n }, (_, i) => i)
  order.sort((a, b) => points[2 * a] - points[2 * b] || points[2 * a + 1] - points[2 * b + 1])
  const hull: number[] = []
  const cross = (o: number, a: number, b: number) =>
    (points[2 * a] - points[2 * o]) * (points[2 * b + 1] - points[2 * o + 1]) -
    (points[2 * a + 1] - points[2 * o + 1]) * (points[2 * b] - points[2 * o])
  const chain = (indices: number[]) => {
    const stack: number[] = []
    for (const i of indices) {
      while (stack.length >= 2 && cross(stack[stack.length - 2], stack[stack.length - 1], i) <= 0) stack.pop()
      stack.push(i)
    }
    stack.pop()
    return stack
  }
  const lower = chain(order)
  const upper = chain(order.slice().reverse())
  const all = n <= 1 ? order : lower.concat(upper)
  for (const i of all) hull.push(points[2 * i], points[2 * i + 1])
  return Float64Array.from(hull)
}

/** A minimum-area enclosing rectangle has a side along a hull edge.
 * Four supporting vertices advance around the CCW hull as the edge turns. */
export function boxAngle(points: Float64Array):number {
 const h=convexHull(points), n=h.length/2
 if(n<2)return 0
 const at=[0,0,0,0]
 let best=Infinity,angle=0
 for(let i=0;i<n;i++){
   const j=(i+1)%n, dx=h[2*j]-h[2*i],dy=h[2*j+1]-h[2*i+1],l=Math.hypot(dx,dy)
   if(!l)continue
   const x=dx/l,y=dy/l
   const support=(k:number,u:number,v:number)=>{
     const score=(j:number)=>u*h[2*j]+v*h[2*j+1]
     if(i===0){for(let j=1;j<n;j++)if(score(j)>score(at[k]))at[k]=j}
     else {for(let step=0;step<n;step++){const j=(at[k]+1)%n;if(score(j)<score(at[k]))break;at[k]=j}}
     return score(at[k])
   }
   const area=(support(0,x,y)+support(1,-x,-y))*(support(2,-y,x)+support(3,y,-x))
   const a=(Math.atan2(y,x)+2*Math.PI)%(Math.PI/2)
   if(!Number.isFinite(best)||area<best-1e-12*Math.max(1,best)||(Math.abs(area-best)<=1e-12*Math.max(1,best)&&a<angle)){best=area;angle=a}
 }
 return angle
}
