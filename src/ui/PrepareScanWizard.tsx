// SPDX-License-Identifier: AGPL-3.0-only
// Prepare Scan, run as QUICKSURFACE runs it: a four-step guide over the tools
// the app already has — mesh quality, object symmetry, the primitives to align
// by, and the alignment itself. Each step opens its tool and puts a banner
// over the view; Next, Skip, Back and Finish move between them, and the
// card's × leaves the guide at any step.

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useShell } from '../state/shellStore'

export const PREPARE_STEPS = [
  { title: 'Mesh quality', text: 'Check the scan for separated meshes, holes and duplicate triangles, and repair them with the mesh editing tools to make a watertight mesh. Press Next to move to the next step.', skip: false },
  { title: 'Object symmetry', text: 'If the object is symmetrical, fit its symmetry plane: it is useful as a reference in alignment. Skip this step for a part that is not symmetrical.', skip: true },
  { title: 'Alignment primitives', text: 'Extract primitives with the tools provided. These primitives are used in the next step to align the scan data in the correct position in space.', skip: false },
  { title: 'Alignment of scan data', text: 'Use the extracted primitives to define the coordinate system. Press Apply to reposition the scan data, then Finish.', skip: false },
] as const

export function PrepareScanWizard({ onStep,commitBlocked }: { commitBlocked?:boolean; onStep: (step: number | null, keepSymmetry?: boolean) => void }) {
  const step = useShell(s => s.prepareStep)
  const [help, setHelp] = useState(false)
  const stage = document.querySelector('.stage')
  return <>
    {step !== null && step > 0 && stage && createPortal(<div className="scan-guide" role="status" data-test="prepare-banner">
      <strong>{PREPARE_STEPS[step].title}</strong><p>{PREPARE_STEPS[step].text}</p>
      <p>(Leave the wizard by clicking on the Close [x] button of the control dialog.)</p>
    </div>, stage)}
    <footer className="scan-footer" data-test={step === null ? 'edit-scan-footer' : 'prepare-wizard'}>
      <button className="scan-help" title="Selection and navigation help" aria-expanded={help} onClick={() => setHelp(!help)}>?</button>
      {help && <div className="scan-help-text" role="status">{step === null || step === 0 ? 'Click a surface with Magic Wand. Adjust degrees to grow the region. Alt removes from a selection. Show quick tools dialog displays actions at the pick.' : PREPARE_STEPS[step].text}</div>}
      {step !== null && step >= 2 && <button data-test="prepare-back" onClick={() => onStep(step - 1)}>&lt; Back</button>}
      {step === null ? <button data-test="edit-scan-close" disabled={commitBlocked} onClick={() => onStep(null)}>Close</button> :
        step === 3 ? <button data-test="prepare-finish" onClick={() => onStep(null)}>Finish</button> :
        <button data-test="prepare-next" disabled={step===0&&commitBlocked} onClick={() => onStep(step + 1, step === 1)}>Next &gt;</button>}
      {step === 1 && <button data-test="prepare-skip" onClick={() => onStep(2)}>Skip</button>}
    </footer>
  </>
}
