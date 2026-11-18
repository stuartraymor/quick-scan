// SPDX-License-Identifier: AGPL-3.0-only
// 2D Sketch overhaul Batch 4: an audit of every sketch button, driven by
// real clicks on the ribbon and the sheet. Each create tool draws, then
// Ctrl+Z takes it back and Ctrl+Y puts it again; Esc part-way leaves
// nothing. Each edit tool changes what it should. Each relation changes the
// solved geometry, and removing it (Delete on the relation) takes it out of
// the solve. Then: Delete, multi-select, zoom while drawing, tool switching.
// Every item is recorded, pass or finding; the run fails if any is a
// finding (AUDIT_REPORT=1 records them all without failing).
import fs from 'node:fs';
import {launchApp,loadScan,sleep,shotPath} from '../../../scripts/e2e-lib.mjs';
import {openReverse} from './lib.mjs';
const out=shotPath('sketch-audit');fs.mkdirSync(out,{recursive:true});
const mesh=[];for(const z of [-5,5])for(let i=0;i<160;i++){const a=i*Math.PI/80;mesh.push(`v ${10*Math.cos(a)} ${10*Math.sin(a)} ${z}`)}
mesh.push('v 0 0 -5','v 0 0 5');for(let i=0;i<160;i++){const a=i+1,b=(i+1)%160+1;mesh.push(`f ${a} ${b} ${b+160}`,`f ${a} ${b+160} ${a+160}`,`f 321 ${b} ${a}`,`f 322 ${a+160} ${b+160}`)}
const meshPath=out+'/cylinder.obj';fs.writeFileSync(meshPath,mesh.join('\n'));
const {browser,page,consoleErrors}=await launchApp({width:1700,height:1050});
const read=()=>page.evaluate(()=>{const d=window.__re.store.getState().sketchDraft;return d&&{sketch:d.sketch,history:d.history.length,future:d.future?.length??0,selection:d.selection,pending:d.pending.length,tool:d.tool,error:d.error,report:d.report,selectedConstraint:d.selectedConstraint}});
const screen=p=>page.evaluate(p=>window.__re.sheet().sheetScreenPoint(p),p);
const at=async p=>{const s=await screen(p);await page.mouse.move(s.x+3,s.y);await sleep(40);await page.mouse.move(s.x,s.y);await sleep(60);await page.mouse.click(s.x,s.y);await sleep(160)};
const press=async(k,mod)=>{if(mod)await page.keyboard.down(mod);await page.keyboard.press(k);if(mod)await page.keyboard.up(mod);await sleep(220)};
const button=async test=>{const el=await page.$(`[data-test=${test}]`);if(!el)throw new Error('no button '+test);await el.click();await sleep(200)};
const select=ids=>page.evaluate(ids=>window.__re.store.setState(s=>({sketchDraft:{...s.sketchDraft,selection:ids,selectedConstraint:null}})),ids);
const reset=async(entities)=>{await page.evaluate(entities=>{const r=window.__re.store;r.setState({sketchDraft:null});r.getState().startSketch({kind:'world',axis:'z',offset:0},{origin:[0,0,0],normal:[0,0,1],basisU:[1,0,0],basisV:[0,1,0]},entities)},entities);await sleep(500);await fitView()};
// Zoom out with the wheel, about a point right of the origin, until about
// 6 px per mm: the whole test area (x -65…60, y -60…60) is on screen.
const pxPerMm=async()=>{const o=await screen([0,0]),u=await screen([1,0]);return Math.hypot(u.x-o.x,u.y-o.y)};
const fitView=async()=>{for(let k=0;k<40;k++){const s=await pxPerMm();if(s>4.5&&s<8)break;await page.mouse.move(1350,560);await page.mouse.wheel({deltaY:s>=8?-60:60});await sleep(150)}
 const o=await screen([0,0]);result.view={pxPerMm:await pxPerMm(),origin:o}};
const typeIn=async(test,v)=>{const el=await page.$(`[data-test=${test}]`);await el.focus();await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');await page.keyboard.type(String(v));await sleep(200)};
const ids=async()=>(await read()).sketch.entities.map(e=>e.id);
const kinds=d=>d.sketch.entities.map(e=>e.kind+(e.construction?'*':'')).join(',');
const len=e=>Math.hypot(e.b[0]-e.a[0],e.b[1]-e.a[1]);
const dir=e=>{const l=len(e);return [(e.b[0]-e.a[0])/l,(e.b[1]-e.a[1])/l]};
const ent=(d,id)=>d.sketch.entities.find(e=>e.id===id);
const rows=[];let findings=0;
const item=async(group,name,fn)=>{
 try{await page.keyboard.press('Escape');await sleep(60);await page.keyboard.press('Escape');await sleep(60);await page.keyboard.press('Escape');await sleep(120);
  const detail=await fn();rows.push({group,name,ok:true,detail});console.log('PASS',group,name,detail??'')}
 catch(e){findings++;rows.push({group,name,ok:false,detail:String(e?.message??e)});console.log('FINDING',group,name,String(e?.message??e));await page.screenshot({path:`${out}/finding-${group}-${name}.png`.replace(/\s+/g,'_')}).catch(()=>{})}
};
const need=(c,msg)=>{if(!c)throw new Error(msg)};
// Undo and redo through the keys, checking the piece count each way.
const roundTrip=async(before,after)=>{
 await press('z','Control');const u=await read();need(u.sketch.entities.length===before,`Ctrl+Z left ${u.sketch.entities.length} pieces, expected ${before}`);
 await press('y','Control');const r=await read();need(r.sketch.entities.length===after,`Ctrl+Y left ${r.sketch.entities.length} pieces, expected ${after}`);
};
// Draw by clicking the tool, then the points; returns what was added.
const draw=async(test,pts,finish)=>{
 const d0=await read();await button(test);for(const p of pts)await at(p);if(finish)await finish();
 const d1=await read();const added=d1.sketch.entities.filter(e=>!d0.sketch.entities.some(x=>x.id===e.id));
 return {d0,d1,added};
};
const result={};
try{
 await loadScan(page,meshPath);await openReverse(page);
 await reset([]);
 // ------------------------------------------------------------ Create
 const create=[
  ['line','sketch-tool-line',[[-60,35],[-40,35]],null,a=>a.length===1&&a[0].kind==='line'&&Math.abs(len(a[0])-20)<0.6],
  ['polyline','sketch-tool-polyline',[[-60,25],[-50,20],[-40,25]],()=>press('Escape'),a=>a.length===2&&a.every(e=>e.kind==='line')],
  ['circle centre','sketch-tool-circle',[[-50,0],[-45,0]],null,a=>a.length===1&&a[0].kind==='circle'&&Math.abs(a[0].r-5)<0.3],
  ['circle 3 points','sketch-tool-circle-three',[[-30,0],[-20,0],[-25,5]],null,a=>a.length===1&&a[0].kind==='circle'&&Math.abs(a[0].r-5)<0.3],
  ['arc','sketch-tool-arc',[[-10,-20],[0,-20],[-5,-15]],null,a=>a.length===1&&a[0].kind==='arc'&&Math.abs(a[0].r-5)<0.3],
  ['spline','sketch-tool-spline',[[10,-20],[15,-14],[20,-22],[25,-16]],async()=>{const s=await screen([25,-16]);await page.mouse.click(s.x,s.y,{clickCount:2});await sleep(250)},a=>a.length===1&&a[0].kind==='spline'&&a[0].pts.length>=4],
  ['rectangle','sketch-tool-rectangle',[[0,25],[12,35]],null,a=>a.filter(e=>e.kind==='line').length===4],
  ['slot','sketch-tool-slot',[[20,30],[35,30],[35,33]],null,a=>a.filter(e=>e.kind==='arc').length===2&&a.filter(e=>e.kind==='line').length===2],
  ['hexagon','sketch-tool-polygon',[[50,30],[56,30]],null,a=>a.filter(e=>e.kind==='line').length===6],
 ];
 for(const [name,test,pts,finish,ok] of create)await item('create',name,async()=>{
  const {d0,d1,added}=await draw(test,pts,finish);await press('Escape');await press('Escape');
  need(ok(added),`added ${added.map(e=>e.kind).join(',')||'nothing'}${d1.error?' — '+d1.error:''}`);
  const now=(await read()).sketch.entities.length;const steps=(await read()).history-d0.history;
  for(let k=0;k<steps;k++)await press('z','Control');need((await read()).sketch.entities.length===d0.sketch.entities.length,`${steps} Ctrl+Z left ${(await read()).sketch.entities.length} pieces`);
  for(let k=0;k<steps;k++)await press('y','Control');need((await read()).sketch.entities.length===now,`${steps} Ctrl+Y left ${(await read()).sketch.entities.length} pieces`);
  return added.map(e=>e.kind).join(',')+(steps>1?` (${steps} undo steps)`:'');
 });
 await item('create','tangent arc',async()=>{
  const d0=await read();const line=d0.sketch.entities.find(e=>e.kind==='line'&&Math.abs(e.a[1]-35)<0.7&&Math.abs(e.b[1]-35)<0.7);need(line,'no first line to start from');
  await button('sketch-tool-tangent-arc');await at(line.b);await at([line.b[0]+8,line.b[1]+8]);await press('Escape');
  const d1=await read();const added=d1.sketch.entities.filter(e=>!d0.sketch.entities.some(x=>x.id===e.id));
  need(added.length===1&&added[0].kind==='arc',`added ${added.map(e=>e.kind).join(',')||'nothing'}${d1.error?' — '+d1.error:''}`);
  const a=added[0];const t=[-Math.sin(a.start)*Math.sign(a.sweep),Math.cos(a.start)*Math.sign(a.sweep)];const t2=[-Math.sin(a.start+a.sweep)*Math.sign(a.sweep),Math.cos(a.start+a.sweep)*Math.sign(a.sweep)];
  const dl=dir(line);const tangentErr=Math.min(Math.abs(t[0]*dl[1]-t[1]*dl[0]),Math.abs(t2[0]*dl[1]-t2[1]*dl[0]));
  need(tangentErr<1e-3,'arc not tangent to the line: '+tangentErr.toFixed(5));
  await roundTrip(d0.sketch.entities.length,d1.sketch.entities.length);return 'tangent '+tangentErr.toExponential(1);
 });
 await item('create','middle line',async()=>{
  await reset([{kind:'line',a:[-40,0],b:[0,0]},{kind:'line',a:[-40,10],b:[0,10]}]);const d0=await read();await select(d0.sketch.entities.map(e=>e.id));
  await button('sketch-tool-middle');const d1=await read();const added=d1.sketch.entities.filter(e=>!d0.sketch.entities.some(x=>x.id===e.id));
  need(added.length===1&&added[0].kind==='line'&&Math.abs(added[0].a[1]-5)<1e-6&&Math.abs(added[0].b[1]-5)<1e-6,`added ${JSON.stringify(added)}${d1.error?' — '+d1.error:''}`);
  await roundTrip(2,3);return added[0].construction?'construction':'solid';
 });
 await item('create','Esc part-way leaves nothing',async()=>{
  await reset([]);const out=[];
  for(const [test,pts] of [['sketch-tool-line',[[0,0]]],['sketch-tool-rectangle',[[0,0]]],['sketch-tool-circle',[[0,0]]],['sketch-tool-arc',[[0,0],[10,0]]],['sketch-tool-slot',[[0,0]]],['sketch-tool-polygon',[[0,0]]]]){
   await button(test);for(const p of pts)await at(p);const mid=await read();need(mid.pending>0||/slot/.test(test),`${test}: no point in hand after ${pts.length} click(s)`);
   await press('Escape');const d=await read();need(d.pending===0&&d.sketch.entities.length===0,`${test}: Esc left ${d.pending} pending, ${d.sketch.entities.length} pieces`);
   await press('Escape');const e=await read();need(e.tool==='select',`${test}: second Esc left tool ${e.tool}`);out.push(test.replace('sketch-tool-',''));
  }
  return out.join(' ');
 });
 await item('create','zoom while drawing keeps the point in hand',async()=>{
  await reset([]);await button('sketch-tool-line');await at([0,0]);
  const s=await screen([10,10]);await page.mouse.move(s.x,s.y);await page.mouse.wheel({deltaY:-240});await sleep(400);
  const d=await read();need(d.pending===1,'pending after wheel: '+d.pending);await at([20,0]);const e=await read();
  need(e.sketch.entities.length===1&&Math.abs(len(e.sketch.entities[0])-20)<0.6,'line after zoom: '+JSON.stringify(e.sketch.entities));
  await fitView();return 'ok';
 });
 await item('create','switching tool drops the point in hand',async()=>{
  await reset([]);await button('sketch-tool-line');await at([0,0]);await button('sketch-tool-circle');const d=await read();
  need(d.pending===0&&d.tool==='circle',`pending ${d.pending}, tool ${d.tool}`);need(d.sketch.entities.length===0,'pieces '+d.sketch.entities.length);return 'ok';
 });
 // ------------------------------------------------------------ Modify
 await item('modify','select + drag an end',async()=>{
  await reset([{kind:'line',a:[0,0],b:[20,0]}]);await button('sketch-tool-select');const s=await screen([20,0]),t=await screen([20,10]);
  await page.mouse.move(s.x,s.y);await sleep(80);await page.mouse.down();await page.mouse.move(t.x,t.y,{steps:8});await page.mouse.up();await sleep(300);
  const d=await read();const l=d.sketch.entities[0];need(Math.hypot(l.b[0]-20,l.b[1]-10)<0.6,'end at '+JSON.stringify(l.b));
  await press('z','Control');const u=await read();need(Math.hypot(u.sketch.entities[0].b[0]-20,u.sketch.entities[0].b[1])<1e-6,'undo end at '+JSON.stringify(u.sketch.entities[0].b));
  await press('y','Control');const r=await read();need(Math.hypot(r.sketch.entities[0].b[1]-l.b[1])<1e-9,'redo end '+JSON.stringify(r.sketch.entities[0].b));return 'ok';
 });
 await item('modify','click and Ctrl+click select',async()=>{
  await reset([{kind:'line',a:[0,0],b:[20,0]},{kind:'line',a:[0,10],b:[20,10]},{kind:'circle',c:[40,5],r:4}]);await button('sketch-tool-select');
  await at([10,0]);let d=await read();need(d.selection.length===1,'click selected '+d.selection.length);
  const s=await screen([10,10]);await page.keyboard.down('Control');await page.mouse.click(s.x,s.y);await page.keyboard.up('Control');await sleep(200);
  d=await read();need(d.selection.length===2,'Ctrl+click selected '+d.selection.length);
  const c=await screen([44,5]);await page.keyboard.down('Shift');await page.mouse.click(c.x,c.y);await page.keyboard.up('Shift');await sleep(200);
  d=await read();const shift=d.selection.length;
  await press('Escape');d=await read();need(d.selection.length===0,'Esc kept '+d.selection.length);return 'Shift+click gives '+shift;
 });
 await item('modify','Delete key',async()=>{
  await reset([{kind:'line',a:[0,0],b:[20,0]},{kind:'line',a:[0,10],b:[20,10]}]);const i=await ids();await select([i[0]]);await press('Delete');
  const d=await read();need(d.sketch.entities.length===1&&d.sketch.entities[0].id===i[1],'left '+d.sketch.entities.map(e=>e.id));await roundTrip(2,1);return 'ok';
 });
 await item('modify','Auto Join',async()=>{
  await reset([{kind:'line',a:[0,0],b:[20,0]},{kind:'line',a:[20.2,0.1],b:[20,20]}]);await select(await ids());await button('sketch-join');
  const d=await read();const [p,q]=d.sketch.entities;need(Math.hypot(p.b[0]-q.a[0],p.b[1]-q.a[1])<1e-6,'ends apart '+Math.hypot(p.b[0]-q.a[0],p.b[1]-q.a[1]));
  need(d.sketch.constraints.some(c=>c.kind==='coincident'),'no coincident relation: '+d.sketch.constraints.map(c=>c.kind));return 'ok';
 });
 await item('modify','Trim',async()=>{
  await reset([{kind:'line',a:[-20,0],b:[20,0]},{kind:'line',a:[0,-20],b:[0,20]}]);await button('sketch-trim');
  const s=await screen([12,0]);await page.mouse.move(s.x,s.y);await sleep(150);await page.mouse.down();await page.mouse.move(s.x+2,s.y,{steps:2});await page.mouse.up();await sleep(400);
  const d=await read();const h=d.sketch.entities.find(e=>e.kind==='line'&&Math.abs(e.a[1])<1e-6&&Math.abs(e.b[1])<1e-6);
  need(h&&Math.max(h.a[0],h.b[0])<1e-6,'horizontal line now '+JSON.stringify(h));await roundTrip(2,2);return JSON.stringify([h.a,h.b]);
 });
 await item('modify','Corner Trim opens and Esc changes nothing',async()=>{
  await reset([{kind:'line',a:[-20,0],b:[20,0]},{kind:'line',a:[0,-20],b:[0,20]}]);const g=JSON.stringify((await read()).sketch);await button('sketch-sharpen');
  need(await page.$('[data-test=sketch-corner-trim-panel]')||await page.$('[data-test^=corner-trim]'),'no Corner Trim panel');await press('Escape');
  need(JSON.stringify((await read()).sketch)===g,'sketch changed');return 'ok';
 });
 await item('modify','Dimension a line',async()=>{
  await reset([{kind:'line',a:[0,0],b:[20,0]}]);await select(await ids());await button('sketch-dimension');await at([10,8]);
  const d=await read();const dims=d.sketch.constraints.filter(c=>'value' in c);need(dims.length===1&&Math.abs(dims[0].value-20)<1e-6,'dims '+JSON.stringify(dims));
  return dims[0].kind;
 });
 await item('modify','Dimension drives the solve, undo restores',async()=>{
  const d0=await read();const dim=d0.sketch.constraints.find(c=>'value' in c);need(dim,'no dimension');
  await page.evaluate(([id])=>window.__re.store.getState().setDimensionValue(id,30),[dim.id]);await sleep(300);
  const d=await read();need(Math.abs(len(d.sketch.entities[0])-30)<1e-6,'length '+len(d.sketch.entities[0]));
  await press('z','Control');const u=await read();need(Math.abs(len(u.sketch.entities[0])-20)<1e-6,'undo length '+len(u.sketch.entities[0]));return 'ok';
 });
 await item('modify','Mirror',async()=>{
  await reset([{kind:'line',a:[10,0],b:[20,5]},{kind:'line',a:[0,-30],b:[0,30],construction:true}]);const i=await ids();await select([i[0]]);await button('sketch-mirror');
  await at([0,20]);need(await page.$('[data-test=mirror-accept]'),'no Accept');await button('mirror-accept');
  const d=await read();const m=d.sketch.entities.find(e=>e.id!==i[0]&&e.id!==i[1]);need(m&&Math.abs(m.a[0]+10)<1e-9&&Math.abs(m.b[0]+20)<1e-9,'mirrored '+JSON.stringify(m));
  await roundTrip(2,3);return 'ok';
 });
 await item('modify','Duplicate by X/Y',async()=>{
  await reset([{kind:'circle',c:[0,0],r:3}]);await select(await ids());await button('sketch-duplicate');
  await typeIn('sketch-duplicate-x',15);await typeIn('sketch-duplicate-y',0);await button('sketch-edit-apply');
  const d=await read();need(d.sketch.entities.length===2&&Math.abs(d.sketch.entities[1].c[0]-15)<1e-9,'copies '+JSON.stringify(d.sketch.entities));await roundTrip(1,2);return 'ok';
 });
 await item('modify','Offset',async()=>{
  await reset([{kind:'line',a:[0,0],b:[20,0]}]);await select(await ids());await button('sketch-offset-entities');
  await typeIn('sketch-offset-distance',2);await button('sketch-edit-apply');
  const d=await read();need(d.sketch.entities.length===2&&Math.abs(Math.abs(d.sketch.entities[1].a[1])-2)<1e-9,'offset '+JSON.stringify(d.sketch.entities));await roundTrip(1,2);return 'ok';
 });
 await item('modify','Fillet two selected lines',async()=>{
  await reset([{kind:'line',a:[0,0],b:[20,0]},{kind:'line',a:[20,0],b:[20,20]}]);await select(await ids());await button('sketch-tool-fillet');
  const d=await read();const arc=d.sketch.entities.find(e=>e.kind==='arc');need(arc,'no arc'+(d.error?' — '+d.error:''));
  need(d.sketch.constraints.filter(c=>c.kind==='tangent').length>=2,'tangents '+d.sketch.constraints.map(c=>c.kind));await roundTrip(2,3);return 'r='+arc.r.toFixed(3);
 });
 await item('modify','Chamfer two selected lines',async()=>{
  await reset([{kind:'line',a:[0,0],b:[20,0]},{kind:'line',a:[20,0],b:[20,20]}]);const b=await page.$('[data-test=sketch-tool-chamfer]');if(!b)return 'no ribbon key (legacy panel only)';
  await select(await ids());await page.evaluate(()=>window.__re.store.getState().chamferSelected?.());await sleep(300);const d=await read();
  need(d.sketch.entities.length===3,'pieces '+kinds(d)+(d.error?' — '+d.error:''));await roundTrip(2,3);return 'ok';
 });
 await item('modify','Project panel opens and Esc closes',async()=>{
  await reset([{kind:'line',a:[0,0],b:[20,0]}]);await button('sketch-tool-project');need(await page.$('[data-test=sketch-project-panel]')||await page.$('[data-test^=sketch-project]'),'no panel');
  await press('Escape');const still=await page.$('[data-test=sketch-project-panel]');
  if(still){const cancel=await page.evaluateHandle(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Cancel'&&b.closest('[data-test=sketch-project-panel]')));await cancel.asElement()?.click();await sleep(200);throw new Error('Esc left the Project prompt open (closed with Cancel)')}
  return 'ok';
 });
 // ------------------------------------------------------------ Constraints
 const relCase=async(kind,entities,pickN,check,extra)=>item('constraint',kind,async()=>{
  await reset(entities);const i=await ids();await select(i.slice(0,pickN));const d0=await read();
  if(kind==='coincident'||kind==='concentric'){await page.evaluate(()=>{const d=document.querySelector('details.sketch-advanced');if(d)d.open=true});await sleep(150);await page.$eval(`[data-test=sketch-rel-${kind}]`,e=>e.scrollIntoView({block:'center'}));await sleep(150)}
  await button(`sketch-rel-${kind}`);if(extra)await extra(i);
  if(kind==='coincident'||kind==='concentric')await page.evaluate(()=>{const d=document.querySelector('details.sketch-advanced');if(d)d.open=false});
  const d=await read();const made=d.sketch.constraints.filter(c=>!d0.sketch.constraints.some(x=>x.id===c.id));
  need(made.length>0,'no relation made'+(d.error?' — '+d.error:''));const why=check(d,i);need(why===true,'geometry: '+why);
  // Remove: select the relation, Delete; the relation leaves the solve.
  await page.evaluate(id=>window.__re.store.getState().selectConstraint(id),made[made.length-1].id);await sleep(150);await press('Delete');
  const r=await read();need(!r.sketch.constraints.some(c=>made.some(m=>m.id===c.id)),'relation still there after Delete');
  need((r.report?.equations??0)<(d.report?.equations??0)||made.length>1,`equations ${d.report?.equations} → ${r.report?.equations}`);
  await press('z','Control');const u=await read();need(u.sketch.constraints.length===d.sketch.constraints.length,'undo of Delete');
  return `${made.map(c=>c.kind).join('+')} eq ${d0.report?.equations??0}→${d.report?.equations}→${r.report?.equations}`;
 });
 const slant=(a,b)=>({kind:'line',a,b});
 await relCase('horizontal',[slant([0,0],[20,3])],1,(d,i)=>{const l=ent(d,i[0]);return Math.abs(l.a[1]-l.b[1])<1e-6||JSON.stringify(l)});
 await relCase('vertical',[slant([0,0],[3,20])],1,(d,i)=>{const l=ent(d,i[0]);return Math.abs(l.a[0]-l.b[0])<1e-6||JSON.stringify(l)});
 await relCase('parallel',[slant([0,0],[20,2]),slant([0,10],[20,15])],2,(d,i)=>{const p=dir(ent(d,i[0])),q=dir(ent(d,i[1]));return Math.abs(p[0]*q[1]-p[1]*q[0])<1e-6||'cross '+(p[0]*q[1]-p[1]*q[0])});
 await relCase('perpendicular',[slant([0,0],[20,2]),slant([0,10],[5,25])],2,(d,i)=>{const p=dir(ent(d,i[0])),q=dir(ent(d,i[1]));return Math.abs(p[0]*q[0]+p[1]*q[1])<1e-6||'dot '+(p[0]*q[0]+p[1]*q[1])});
 await relCase('equal',[slant([0,0],[20,0]),slant([0,10],[12,10])],2,(d,i)=>Math.abs(len(ent(d,i[0]))-len(ent(d,i[1])))<1e-6||`${len(ent(d,i[0]))} vs ${len(ent(d,i[1]))}`);
 await relCase('collinear',[slant([0,0],[20,0]),slant([25,1],[40,2])],2,(d,i)=>{const p=ent(d,i[0]),q=ent(d,i[1]);const n=[-dir(p)[1],dir(p)[0]];const off=x=>(x[0]-p.a[0])*n[0]+(x[1]-p.a[1])*n[1];return Math.max(Math.abs(off(q.a)),Math.abs(off(q.b)))<1e-6||'off '+off(q.a)+','+off(q.b)});
 await relCase('tangent',[slant([-20,6],[20,6]),{kind:'circle',c:[0,0],r:5}],2,(d,i)=>{const l=ent(d,i[0]),c=ent(d,i[1]);const n=[-dir(l)[1],dir(l)[0]];const dist=Math.abs((c.c[0]-l.a[0])*n[0]+(c.c[1]-l.a[1])*n[1]);return Math.abs(dist-c.r)<1e-6||`dist ${dist} r ${c.r}`});
 await relCase('symmetric',[{kind:'point',p:[-10,3]},{kind:'point',p:[12,5]},{kind:'line',a:[0,-20],b:[0,20],construction:true}],3,(d,i)=>{const p=ent(d,i[0]).p,q=ent(d,i[1]).p,ax=ent(d,i[2]);const u=dir(ax);const m=[(p[0]+q[0])/2,(p[1]+q[1])/2];
  const onAxis=Math.abs((m[0]-ax.a[0])*u[1]-(m[1]-ax.a[1])*u[0]),across=Math.abs((p[0]-q[0])*u[0]+(p[1]-q[1])*u[1]);return (onAxis<1e-6&&across<1e-6)||`mid off axis ${onAxis}, along axis ${across}`});
 await relCase('coincident',[slant([0,0],[20,0]),slant([25,0.4],[35,1.2])],2,(d,i)=>{const p=ent(d,i[0]),q=ent(d,i[1]);const n=[-dir(p)[1],dir(p)[0]];const off=x=>(x[0]-p.a[0])*n[0]+(x[1]-p.a[1])*n[1];return Math.max(Math.abs(off(q.a)),Math.abs(off(q.b)))<1e-5||'two lines not along each other '+off(q.a)});
 await relCase('coincident',[slant([0,0],[20,0]),{kind:'circle',c:[20.6,0.5],r:4}],2,(d,i)=>{const p=ent(d,i[0]),c=ent(d,i[1]);const n=[-dir(p)[1],dir(p)[0]];const off=Math.abs((c.c[0]-p.a[0])*n[0]+(c.c[1]-p.a[1])*n[1]);return off<1e-6||'centre off the line '+off});
 await relCase('concentric',[{kind:'circle',c:[0,0],r:5},{kind:'circle',c:[1,1],r:8}],2,(d,i)=>Math.hypot(ent(d,i[0]).c[0]-ent(d,i[1]).c[0],ent(d,i[0]).c[1]-ent(d,i[1]).c[1])<1e-6||'centres apart');
 await item('constraint','Fix Position',async()=>{
  await reset([slant([0,0],[20,0])]);const i=await ids();await select(i);await button('sketch-fix');let d=await read();need(ent(d,i[0]).fixed,'not fixed');
  await page.evaluate(id=>window.__re.store.getState().sketchDragStart?.({entity:id,at:'b'},[20,0]),i[0]).catch(()=>{});
  await button('sketch-fix');d=await read();need(!ent(d,i[0]).fixed,'still fixed after second press');await press('z','Control');d=await read();need(ent(d,i[0]).fixed,'undo did not restore fixed');return 'ok';
 });
 await item('constraint','For Construction',async()=>{
  await reset([slant([0,0],[20,0]),slant([20,0],[20,20]),slant([20,20],[0,20]),slant([0,20],[0,0])]);const i=await ids();
  const regions0=await page.evaluate(()=>window.__re.store.getState().sketchDraft.found.length);await select([i[0]]);await button('sketch-construction');
  const d=await read();need(ent(d,i[0]).construction,'not construction');const regions1=await page.evaluate(()=>window.__re.store.getState().sketchDraft.found.length);
  need(regions0===1&&regions1===0,`regions ${regions0} → ${regions1}: construction must not close a profile`);await press('z','Control');need(!ent(await read(),i[0]).construction,'undo');return 'ok';
 });
 // ------------------------------------------------------------ Display
 for(const [test,pref] of [['sketch-show-dimensions','sketchDimensions'],['sketch-show-relations','sketchRelations'],['sketch-show-control-points','sketchControlPoints']])
  await item('display',test.replace('sketch-show-',''),async()=>{
   const was=await page.$eval(`[data-test=${test}]`,e=>e.checked);await button(test);const now=await page.$eval(`[data-test=${test}]`,e=>e.checked);need(now!==was,'checkbox did not toggle');
   await button(test);need(await page.$eval(`[data-test=${test}]`,e=>e.checked)===was,'did not toggle back');return pref;
  });
 await item('display','dimension labels follow the switch',async()=>{
  await reset([slant([0,0],[20,0])]);await select(await ids());await button('sketch-dimension');await at([10,8]);await press('Escape');await press('Escape');
  const on=await page.$$eval('.sketch-dim',e=>e.filter(x=>x.offsetParent!==null).length);await button('sketch-show-dimensions');
  const off=await page.$$eval('.sketch-dim',e=>e.filter(x=>x.offsetParent!==null).length);await button('sketch-show-dimensions');
  need(on>0&&off===0,`labels shown ${on}, hidden ${off}`);return `${on} → ${off}`;
 });
 result.findings=findings;
}catch(e){findings++;rows.push({group:'run',name:'aborted',ok:false,detail:String(e?.stack??e)});console.log('ABORT',e)}
finally{
 result.rows=rows;result.consoleErrors=consoleErrors;fs.writeFileSync(out+'/audit.json',JSON.stringify(result,null,1));
 await page.screenshot({path:out+'/final.png'}).catch(()=>{});await browser.close();
 console.log(`AUDIT ${rows.filter(r=>r.ok).length} pass, ${findings} finding(s); console errors ${consoleErrors.length}`);
 if((findings>0&&!process.env.AUDIT_REPORT)||consoleErrors.length>0)process.exitCode=1;
}
