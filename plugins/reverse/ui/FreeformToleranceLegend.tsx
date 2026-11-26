// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react'
import { useLength } from '../../../src/app/useUnits'
import type { PreviewColouring } from '../core/freeform/previewDeviation'

export function FreeformToleranceLegend({ tolerance, colouring, testId, children }: {
  tolerance: number; colouring: PreviewColouring; testId: string; children?: ReactNode
}) {
  const length = useLength()
  return <aside className="ff-viewport-legend" data-test={testId} aria-label="Signed scan deviation from surface">
    <div className="ff-viewport-scale">
      <span style={{top:0}}>{length.fmt(5*tolerance)}</span>
      <span style={{top:'35%'}}>{length.fmt(tolerance)}</span>
      <span style={{top:'65%'}}>{length.fmt(-tolerance)}</span>
      <span style={{top:'100%'}}>{length.fmt(-5*tolerance)}</span>
      <div className={'ff-viewport-ramp' + (colouring === 'pass-fail' ? ' ff-viewport-pass-fail' : '')} aria-hidden="true" />
    </div>
    <small>{colouring === 'gradient' ? 'Dark gray outside scale' : 'Pass / Fail'}</small>
    {children}
  </aside>
}
