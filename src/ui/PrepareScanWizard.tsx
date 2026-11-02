// SPDX-License-Identifier: AGPL-3.0-only
// Prepare Scan, run as QUICKSURFACE runs it: a four-step guide over the tools
// the app already has — mesh quality, object symmetry, the primitives to align
// by, and the alignment itself. Each step opens its tool and puts a banner
// over the view; Next, Skip, Back and Finish move between them, and the
// card's × leaves the guide at any step.

import { useShell } from '../state/shellStore'

export const PREPARE_STEPS = [
  { title: 'Mesh quality', text: 'Check the scan for separated meshes, holes and duplicate triangles, and repair them with the mesh editing tools to make a watertight mesh. Press Next to move to the next step.', skip: false },
  { title: 'Object symmetry', text: 'If the object is symmetrical, fit its symmetry plane: it is useful as a reference in alignment. Skip this step for a part that is not symmetrical.', skip: true },
  { title: 'Alignment primitives', text: 'Extract primitives with the tools provided. These primitives are used in the next step to align the scan data in the correct position in space.', skip: false },
  { title: 'Alignment of scan data', text: 'Use the extracted primitives to define the coordinate system. Press Apply to reposition the scan data, then Finish.', skip: false },
] as const

export function PrepareScanWizard({ onStep }: { onStep: (step: number) => void }) {
  const step = useShell((s) => s.prepareStep)
  if (step === null) return null
  const s = PREPARE_STEPS[step]
  const go = (next: number | null) => { useShell.getState().setPrepareStep(next); if (next !== null) onStep(next) }
  const last = step === PREPARE_STEPS.length - 1
  return (
    <>
      <div className="qs-wizard-banner" data-test="prepare-banner" role="status">
        <b>{s.title}</b>
        <p>{s.text}</p>
        <p>(Leave the wizard with the × of its card.)</p>
      </div>
      <section className="qs-wizard-card" data-test="prepare-wizard" aria-label="Prepare Scan">
        <header>
          <b>Prepare Scan · step {step + 1} of {PREPARE_STEPS.length}</b>
          <button className="qs-x" data-test="prepare-x" title="Leave the wizard" onClick={() => go(null)}>×</button>
        </header>
        <footer>
          {step > 0 && <button data-test="prepare-back" onClick={() => go(step - 1)}>&lt; Back</button>}
          {s.skip && <button data-test="prepare-skip" onClick={() => go(step + 1)}>Skip</button>}
          {last
            ? <button className="primary" data-test="prepare-finish" onClick={() => go(null)}>Finish</button>
            : <button className="primary" data-test="prepare-next" onClick={() => go(step + 1)}>Next &gt;</button>}
        </footer>
      </section>
    </>
  )
}
