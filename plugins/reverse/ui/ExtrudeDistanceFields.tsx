// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react'
import { NumberField } from '../../../src/ui/NumberField'
import { negateExpression, resizeFullDepth, spansSketch, type DistanceExtent } from '../core/extrudeDepth'
import { Num } from './featureFields'

export function ExtrudeDistanceFields({ extent, exprs, onExtent, onCreate }: {
  extent: DistanceExtent
  exprs?: Record<string, string>
  onExtent: (extent: DistanceExtent) => void
  onCreate: () => void
}) {
  // Older projects can put both ends on one side of the sketch. Keep those
  // coordinates exactly, and expose the same signed entry for new features.
  const spans = spansSketch(extent)
  const [preferSigned, setPreferSigned] = useState(!spans)
  const signed = preferSigned || !spans
  const sense = extent.to < extent.from ? -1 : 1
  const toSign = signed ? 1 : sense
  const fromSign = signed ? 1 : -sense
  const driven = !!(exprs?.['extent.to'] || exprs?.['extent.from'])
  return <>
    <div data-test="extrude-full-depth">
      <NumberField label="Full depth" kind="length" min={0} step="any" testId="extrude-full-depth-value"
        value={Math.abs(extent.to - extent.from)} disabled={driven || !spans}
        hint={driven ? 'Edit the endpoint expression to change this thickness.' : !spans ? 'Edit the signed offsets for this interval.' : 'Resize both sides about the sketch in their current proportions.'}
        onCommit={(total) => onExtent(resizeFullDepth(extent, total))} />
    </div>
    <Num label={signed ? 'To' : 'Depth 1'} testId="extrude-to" slot="extent.to" nominal="length" min={signed ? undefined : 0}
      value={extent.to * toSign} mapExpression={toSign < 0 ? negateExpression : undefined}
      onCommit={(v) => onExtent({ ...extent, to: v * toSign || 0 })} passKeys={{ enter: onCreate }} />
    <Num label={signed ? 'From' : 'Depth 2'} testId="extrude-from" slot="extent.from" nominal="length" min={signed ? undefined : 0}
      value={extent.from * fromSign} mapExpression={fromSign < 0 ? negateExpression : undefined}
      onCommit={(v) => onExtent({ ...extent, from: v * fromSign || 0 })} />
    <label className="checkrow" title="Measure both endpoints along the sketch normal, including intervals entirely on one side.">
      <input type="checkbox" data-test="extrude-signed" checked={signed} disabled={!spans}
        onChange={(e) => setPreferSigned(e.target.checked)} /> Signed offsets
    </label>
    <p className="hint" data-test="extrude-pick-hint">Click the scan to position an end, or drag its arrow.</p>
  </>
}
