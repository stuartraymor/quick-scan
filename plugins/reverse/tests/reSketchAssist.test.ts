// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, expect, it } from 'vitest'
import { useReverse } from '../state/reStore'
import { beginSketchAssist } from '../state/sketchAssist'
import { DEFAULT_FIT_OPTIONS } from '../core/fitOptions'
import { cloneSketch, addEntity } from '../core/sketch'
import type { Vec2 } from '../../../src/core/flat/types'
const chain: Vec2[]=Array.from({length:161},(_,i)=>[10*Math.cos(i*2*Math.PI/160),10*Math.sin(i*2*Math.PI/160)])
beforeEach(()=>useReverse.getState().startSketch({kind:'world',axis:'z',offset:0},{origin:[0,0,0],normal:[0,0,1],basisU:[1,0,0],basisV:[0,1,0]}))
it('previews without history or mutating the original, then cancels exactly',()=>{
 const base=useReverse.getState().sketchDraft!,copy=cloneSketch(base.sketch),session=beginSketchAssist([chain])
 const preview=session.preview(DEFAULT_FIT_OPTIONS)
 expect(preview.sketch.entities.length).toBeGreaterThan(0);expect(preview.history).toEqual(base.history);expect(base.sketch).toEqual(copy)
 session.preview({...DEFAULT_FIT_OPTIONS,detail:.9});session.cancel();expect(useReverse.getState().sketchDraft).toBe(base)
})
it('accepts one undoable fit, preserves the preview geometry, and lets the chain be refitted after undo',()=>{
 const session=beginSketchAssist([chain]);const proposal=cloneSketch(session.preview(DEFAULT_FIT_OPTIONS).sketch)
 session.accept();session.cancel();expect(useReverse.getState().sketchDraft!.sketch).toEqual(proposal)
 expect(useReverse.getState().sketchDraft!.history).toHaveLength(1)
 useReverse.getState().undoSketch();expect(useReverse.getState().sketchDraft!.sketch.entities).toHaveLength(0)
 useReverse.getState().autoFit([chain],'all');expect(useReverse.getState().sketchDraft!.sketch.entities.length).toBeGreaterThan(0)
})
it('cannot overwrite another draft update on cancel or accept',()=>{
 const session=beginSketchAssist([chain]);session.preview(DEFAULT_FIT_OPTIONS)
 const sketch=cloneSketch(useReverse.getState().sketchDraft!.sketch);addEntity(sketch,{kind:'line',a:[0,0],b:[1,0]});useReverse.getState().setSketch(sketch)
 const changed=useReverse.getState().sketchDraft;expect(()=>session.accept()).toThrow('changed');session.cancel();expect(useReverse.getState().sketchDraft).toBe(changed)
})
