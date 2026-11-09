// SPDX-License-Identifier: AGPL-3.0-only
export type PoleFrame = 'World' | 'Screen' | 'Local'
export type PoleAxis = 'x' | 'y' | 'z'
export type PoleHandle = PoleAxis | 'xy' | 'yz' | 'zx'
export type ProjectedAxes = Record<PoleAxis, { x: number; y: number }>
const pairs = { xy: ['x','y'], yz: ['y','z'], zx: ['z','x'] } as const
export function projectedPoleHandle(x: number, y: number, axes: ProjectedAxes): PoleHandle | null {
  for (const key of ['x','y','z'] as const) {
    const a=axes[key], length=Math.hypot(a.x,a.y)
    if (length < 12) continue
    const along=(x*a.x+y*a.y)/(length*length), off=Math.abs(x*a.y-y*a.x)/length
    if (along >= .45 && along <= 1.08 && off <= 12) return key
  }
  for (const key of ['xy','yz','zx'] as const) {
    const [a,b]=pairs[key].map(k=>axes[k]), determinant=a.x*b.y-a.y*b.x
    if (Math.abs(determinant)<100) continue
    const u=(x*b.y-y*b.x)/determinant, v=(a.x*y-a.y*x)/determinant
    if (u>=.2 && u<=.53 && v>=.2 && v<=.53) return key
  }
  return null
}
export class PoleFrameGizmo {
  private element: HTMLDivElement | null = null
  constructor(private container: HTMLElement | undefined) {}
  show(x: number, y: number, axes: ProjectedAxes) {
    if (!this.container) return
    if (!this.element) {
      this.element=document.createElement('div'); this.element.dataset.test='surface-frame-gizmo'
      Object.assign(this.element.style,{position:'absolute',width:'300px',height:'300px',pointerEvents:'none',zIndex:'4'})
      this.container.appendChild(this.element)
    }
    const planes=Object.values(pairs).map(([i,j])=>{
      const a=axes[i],b=axes[j]
      if(Math.abs(a.x*b.y-a.y*b.x)<100) return ''
      const points=[[.2,.2],[.53,.2],[.53,.53],[.2,.53]].map(([u,v])=>`${a.x*u+b.x*v},${a.y*u+b.y*v}`).join(' ')
      return `<polygon points="${points}" fill="#d5e9e4" fill-opacity="0.6"/>`
    }).join('')
    const arrows=(['x','y','z'] as const).map((key,i)=>{
      const a=axes[key],len=Math.hypot(a.x,a.y)
      if(len<12) return ''
      const ux=a.x/len,uy=a.y/len,color=['#ed3030','#00bf35','#2676ff'][i]
      return `<path d="M${a.x*.5} ${a.y*.5} L${a.x-ux*12} ${a.y-uy*12}" stroke="${color}" stroke-width="7"/><polygon points="${a.x},${a.y} ${a.x-ux*19-uy*10},${a.y-uy*19+ux*10} ${a.x-ux*19+uy*10},${a.y-uy*19-ux*10}" fill="${color}"/>`
    }).join('')
    this.element.innerHTML=`<svg width="300" height="300" viewBox="-150 -150 300 300" aria-hidden="true">${planes}${arrows}</svg>`
    const r=this.container.getBoundingClientRect()
    this.element.style.left=`${x-r.left-150}px`;this.element.style.top=`${y-r.top-150}px`
  }
  hide(){this.element?.remove();this.element=null}
}
