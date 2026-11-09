// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { localPoleRedAxis, localPoleFrame } from '../viewer/localPoleAxis'
import type { PolynomialSurface } from '../core/surfaceStep'
// Our native test-patch export, transposed from IGES U-fast.
const surface: PolynomialSurface = {"u": {"degree": 4, "count": 5, "knots": [0, 1], "mults": [5, 5]}, "v": {"degree": 4, "count": 5, "knots": [0, 1], "mults": [5, 5]}, "poles": [[108.411250393, 58.895654054, 0.733713209], [102.140722528, 66.197062103, -52.974443704], [116.834836323, 76.500599318, -107.67085617], [105.153798746, 63.658534241, -161.775375761], [108.62460114, 54.608476292, -215.145208743], [106.929827244, -83.165560894, 0.09627064139], [105.399042485, -118.079774141, -53.481790823], [96.648207975, -101.878386153, -106.145039283], [103.892680586, -120.465472832, -159.474897627], [99.153647097, -90.267884431, -213.668043576], [-2.167583933, -113.385795612, 1.397536006], [5.424590639, -73.261276704, -52.222351701], [3.234129134, -95.22702455, -106.931492636], [-4.464634948, -70.171116446, -160.392730033], [1.466729607, -108.876319605, -214.093790867], [-99.16351584, -88.517413388, 1.438982704], [-104.515893482, -114.5482015, -52.431602009], [-103.57175376, -106.801769803, -104.954305472], [-100.303366353, -117.969853285, -158.236553773], [-107.524038229, -89.31035049, -211.885003158], [-110.698685803, 52.035230969, 5.097339353], [-101.466385992, 61.766751295, -48.23183411], [-115.08414298, 76.511201292, -103.066420911], [-105.606141994, 67.950542851, -157.36369085], [-108.479183538, 60.069879343, -210.919484765]]}
it.each([
 [0,0,[-3.159684641,0,-26.754885013]],
 [1,1,[15.861519653,15.326546966,0]],
 [2,2,[0,-0.527258361,-25.249699285]],
 [1,2,[17.302393134,13.885673691,0]],
] as const)('matches native Local red movement at %i,%i', (u,v,delta) => {
 const axis=localPoleRedAxis(surface,u,v)!
 const length=Math.hypot(...delta)
 axis.forEach((value,k)=>expect(Math.abs(value-delta[k]/length)).toBeLessThan(1e-9))
})
it('preserves the net and computes bounded indices at edges',()=>{
 const before=structuredClone(surface)
 for(const [u,v] of [[0,0],[0,4],[4,0],[4,4],[0,2],[2,4]]) expect(Math.hypot(...localPoleRedAxis(surface,u,v)!)).toBeCloseTo(1,12)
 expect(surface).toEqual(before)
 expect(()=>localPoleRedAxis(surface,-1,0)).toThrow('outside')
})
it('returns no axis for a collapsed net',()=>{
 expect(localPoleRedAxis({...surface,poles:surface.poles.map(()=>[0,0,0])},2,2)).toBeNull()
})

it('matches the independently measured native green axis',()=>{
 const frame=localPoleFrame(surface,1,1)!
 const delta=[1.316268385,-1.362212696,26.558435685]
 const length=Math.hypot(...delta)
 frame.y.forEach((value,k)=>expect(Math.abs(value-delta[k]/length)).toBeLessThan(1e-9))
 expect(frame.x.reduce((sum,x,k)=>sum+x*frame.y[k],0)).toBeCloseTo(0,12)
})

it('matches native blue movement and forms a right-handed orthonormal frame',()=>{
 const {x,y,z}=localPoleFrame(surface,1,1)!
 const delta=[27.282246561,-28.234532605,-2.800322966]
 const length=Math.hypot(...delta)
 z.forEach((value,k)=>expect(Math.abs(value-delta[k]/length)).toBeLessThan(1e-9))
 for(const a of [x,y,z]) expect(Math.hypot(...a)).toBeCloseTo(1,12)
 const cross=[x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0]]
 cross.forEach((v,k)=>expect(v).toBeCloseTo(z[k],12))
})
