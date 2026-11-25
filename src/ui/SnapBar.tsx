// SPDX-License-Identifier: AGPL-3.0-only
// The snap bar: a row of switches at the bottom of the graphics window that
// say what a click may land on — ends, middles, centres, quadrants, curves,
// scan points. Shown while a tool that snaps or picks is in hand; which set
// it shows follows the tool (see snapFilterStore).

import { useLayoutEffect, useRef } from 'react'
import { SNAP_KEYS, snapProfile, useSnapFilter, type SnapKey } from '../state/snapFilterStore'

/** One mark per kind, drawn as the sketch marks a snap of that kind. */
const ICONS: Record<SnapKey, string> = {
  endpoint: 'M5 5h14v14H5z',
  midpoint: 'M12 5l8 14H4z',
  center: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16M12 11.2v1.6M11.2 12h1.6',
  quadrant: 'M12 3l9 9l-9 9l-9-9z',
  curve: 'M3 17c4-12 8 6 18-10',
  scan: 'M5 8h.01M10 6h.01M15 7h.01M19 10h.01M6 14h.01M11 16h.01M16 15h.01',
}

export function SnapBar() {
  const context = useSnapFilter((s) => s.context)
  const flags = useSnapFilter((s) => s.flags)
  const all = useSnapFilter((s) => s.all)
  const ref = useRef<HTMLDivElement | null>(null)
  // The bar has the bottom left-hand corner and the view keys the bottom
  // right. Where the stage is too narrow for both on one line, the view
  // keys step up above the bar; they come back down when there is room.
  useLayoutEffect(() => {
    const bar = ref.current
    const stage = bar?.parentElement
    const corner = stage?.querySelector<HTMLElement>(':scope > .stagecorner')
    if (!bar || !stage || !corner) return
    const shell = stage.closest<HTMLElement>('.desktop-mid')
    const fit = () => {
      shell?.style.setProperty('--snapbar-clearance', (bar.offsetHeight + 20) + 'px')
      const keys = corner.firstElementChild?.getBoundingClientRect()
      const crowded = !!keys && keys.width > 0 && keys.left < bar.getBoundingClientRect().right + 8
      corner.style.bottom = crowded ? `${bar.offsetHeight + 20}px` : ''
    }
    fit()
    const watch = new ResizeObserver(fit)
    watch.observe(stage)
    watch.observe(bar)
    watch.observe(corner)
    return () => {
      watch.disconnect()
      shell?.style.removeProperty('--snapbar-clearance')
      corner.style.bottom = ''
    }
  }, [context])
  if (!context) return null
  const profile = snapProfile(context)
  const keys = SNAP_KEYS[context === 'sketchPick' ? 'pick' : context]
  const smart = all[profile]
  const title = profile === 'draw' ? 'Snap to' : context === 'pick' ? 'Pick' : 'Measure on'
  return (
    <div ref={ref} className="snapbar" data-test="snap-bar" data-context={context} role="toolbar" aria-label={`${title}: what a click may land on`}
      // The bar is the bar's: a press on it is no click on the sheet under it.
      onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <span className="snapbar-title">{title}</span>
      <button type="button" className={smart ? 'snapkey all on' : 'snapkey all'} data-test="snap-all" aria-pressed={smart}
        title="All — smart snap: every kind at once, and whichever is closest to the cursor is taken"
        onClick={() => useSnapFilter.getState().setAll(profile, !smart)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6" /></svg>
        <span>All</span>
      </button>
      <span className="snapbar-rule" aria-hidden="true" />
      {keys.map(({ key, label, tip }) => (
        <button key={key} type="button" className={smart ? 'snapkey implied' : flags[profile][key] ? 'snapkey on' : 'snapkey'} data-test={`snap-${key}`} aria-pressed={smart || flags[profile][key]} title={smart ? `${tip} (on with All; press to choose kinds one by one)` : tip}
          onClick={() => useSnapFilter.getState().toggle(profile, key)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICONS[key]} /></svg>
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}
