// SPDX-License-Identifier: AGPL-3.0-only
// Exact polynomial, nonperiodic, clamped rectangular B-spline construction.
// Boundary curves use the outer pole rows/columns; no sampling or refitting.
export interface SurfaceAxis { degree: number; count: number; knots: number[]; mults: number[] }
export interface PolynomialSurface { u: SurfaceAxis; v: SurfaceAxis; poles: number[][]; weights?: never; periodicU?: false; periodicV?: false }
export function surfaceAxis(full: ArrayLike<number>, degree: number, count: number): SurfaceAxis {
  const knots: number[] = [], mults: number[] = [];
  for (let i = 0; i < full.length; i++) {
    const value = full[i];
    if (knots.length && knots[knots.length - 1] === value) mults[mults.length - 1]++;
    else { knots.push(value); mults.push(1); }
  }
  return { degree, count, knots, mults };
}
export function validate(s: PolynomialSurface) {
  if (s.weights !== undefined || s.periodicU || s.periodicV) throw Error('Constructor supports nonperiodic polynomial surfaces only');
  for (const axis of ['u', 'v'] as const) {
    const { degree: p, knots: k, mults: m, count: n } = s[axis];
    if (!Number.isInteger(p) || p < 1 || !Number.isInteger(n) || n <= p || k.length < 2 || k.length !== m.length) throw Error('Invalid degree/count/knots');
    if (!k.every(Number.isFinite) || k.some((x,i) => i && x <= k[i-1])) throw Error('Knots must strictly increase');
    if (!m.every(x => Number.isInteger(x) && x > 0) || m[0] !== p+1 || m.at(-1) !== p+1 || m.slice(1,-1).some(x => x > p) || m.reduce((a,b)=>a+b,0) !== n+p+1) throw Error('Invalid clamped multiplicities');
  }
  if (s.poles.length !== s.u.count*s.v.count || s.poles.some(p => p.length !== 3 || !p.every(Number.isFinite))) throw Error('Invalid poles');
}
export function real(x: number) {
  if (!Number.isFinite(x)) throw Error('Nonfinite STEP real');
  const [a,b] = String(Object.is(x,-0) ? 0 : x).split(/e/i);
  return (a.includes('.') ? a : a+'.') + (b === undefined ? '' : 'E'+b);
}
export function writeSurfaceStep(s: PolynomialSurface) {
  validate(s);
  const lines: string[] = [];
  const add = (x: string) => { lines.push(`#${lines.length+1}=${x};`); return lines.length; };
  const refs = (a: number[]) => '('+a.map(x=>'#'+x).join(',')+')';
  const nums = (a: number[],f: (x: number) => string=real) => '('+a.map(f).join(',')+')';
  const app = add("APPLICATION_CONTEXT('automotive design')");
  add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2010,#${app})`);
  const pc = add(`PRODUCT_CONTEXT('',#${app},'mechanical')`);
  const prod = add(`PRODUCT('exact-surface','exact-surface','',(#${pc}))`);
  const form = add(`PRODUCT_DEFINITION_FORMATION('','',#${prod})`);
  const dc = add(`PRODUCT_DEFINITION_CONTEXT('part definition',#${app},'design')`);
  const def = add(`PRODUCT_DEFINITION('design','',#${form},#${dc})`);
  const ds = add(`PRODUCT_DEFINITION_SHAPE('','',#${def})`);
  const lu = add('(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))');
  const au = add('(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))');
  const su = add('(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())');
  const unc = add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-7),#${lu},'distance_accuracy_value','')`);
  const ctx = add(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${unc}))GLOBAL_UNIT_ASSIGNED_CONTEXT((#${lu},#${au},#${su}))REPRESENTATION_CONTEXT('','3D'))`);
  const poles = s.poles.map(p=>add(`CARTESIAN_POINT('',${nums(p)})`));
  const {u,v} = s;
  const matrix = '('+Array.from({length:u.count},(_,i)=>refs(poles.slice(i*v.count,(i+1)*v.count))).join(',')+')';
  const surf = add(`B_SPLINE_SURFACE_WITH_KNOTS('',${u.degree},${v.degree},${matrix},.UNSPECIFIED.,.F.,.F.,.F.,${nums(u.mults,String)},${nums(v.mults,String)},${nums(u.knots)},${nums(v.knots)},.UNSPECIFIED.)`);
  const corner = [0,(u.count-1)*v.count,u.count*v.count-1,v.count-1];
  const verts = corner.map(i=>add(`VERTEX_POINT('',#${poles[i]})`));
  const indices = [Array.from({length:u.count},(_,i)=>i*v.count), Array.from({length:v.count},(_,j)=>(u.count-1)*v.count+j), Array.from({length:u.count},(_,i)=>i*v.count+v.count-1), Array.from({length:v.count},(_,j)=>j)];
  const ends = [[0,1],[1,2],[3,2],[0,3]];
  const edges = indices.map((ii,k)=>{
    const a = k%2===0 ? u : v;
    const curve = add(`B_SPLINE_CURVE_WITH_KNOTS('',${a.degree},${refs(ii.map(i=>poles[i]))},.UNSPECIFIED.,.F.,.F.,${nums(a.mults,String)},${nums(a.knots)},.UNSPECIFIED.)`);
    const [start,end] = ends[k];
    const edge = add(`EDGE_CURVE('',#${verts[start]},#${verts[end]},#${curve},.T.)`);
    return add(`ORIENTED_EDGE('',*,*,#${edge},${k<2?'.T.':'.F.'})`);
  });
  const loop = add(`EDGE_LOOP('',${refs(edges)})`);
  const bound = add(`FACE_OUTER_BOUND('',#${loop},.T.)`);
  const face = add(`ADVANCED_FACE('',(#${bound}),#${surf},.T.)`);
  const shell = add(`OPEN_SHELL('',(#${face}))`);
  const model = add(`SHELL_BASED_SURFACE_MODEL('',(#${shell}))`);
  const rep = add(`MANIFOLD_SURFACE_SHAPE_REPRESENTATION('',(#${model}),#${ctx})`);
  add(`SHAPE_DEFINITION_REPRESENTATION(#${ds},#${rep})`);
  return ['ISO-10303-21;','HEADER;',"FILE_DESCRIPTION(('Exact polynomial surface'),'2;1');","FILE_NAME('surface.step','2026-11-09T00:00:00',(''),(''),'Quick Scan','Quick Scan','');","FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",'ENDSEC;','DATA;',...lines,'ENDSEC;','END-ISO-10303-21;',''].join('\n');
}
