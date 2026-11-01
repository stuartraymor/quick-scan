// SPDX-License-Identifier: AGPL-3.0-only
// Plugin-owned tree rows use the CAD store's selection and visibility actions.
import { Icon } from '../../../src/ui/icons'
import { useStore } from '../../../src/state/store'
import { useDeviation } from '../../../src/state/deviationStore'
import { bodyMaker } from '../core/features'
import { bodyColor, openFeatureEditor, reEditorOpen, useReverse } from '../state/reStore'
import { FEATURE_ICONS } from './featureReading'
import { KeyIcon } from './reIcons'
import { folderPathText } from './BodyList'

function useExplorerLocked() {
  const busy = useStore((s) => s.busy)
  const picking = useDeviation((s) => s.picking)
  const state = useReverse()
  return { state, locked: busy || picking || state.building || state.playback !== null || reEditorOpen(state) }
}

export function ReverseObjects() {
  const { state, locked } = useExplorerLocked()
  const picked = state.listSelection.bodies
  return <details className="explorer-group" open data-test="explorer-cad-bodies">
    <summary><span>CAD bodies</span><small>{state.bodies.length}</small></summary>
    <div className="explorer-children">
      {state.bodies.length === 0 && <p className="explorer-empty">Sketch and build a feature, or import a STEP body.</p>}
      {state.bodies.map((body, index) => {
        const folder = state.bodyFolders.find((f) => f.bodies.includes(body.id))
        const location = folder ? folderPathText(state.bodyFolders, folder.id) : ''
        return <div key={body.id} className={`explorer-row${picked.includes(body.id) ? ' selected' : ''}`}
          onMouseEnter={() => state.setBodyHover({ ids: [body.id], from: 'list' })}
          onMouseLeave={() => { if (useReverse.getState().bodyHover?.from === 'list') useReverse.getState().setBodyHover(null) }}>
          <button type="button" className={`explorer-eye${body.visible && !state.bodiesHidden ? '' : ' is-hidden'}`} disabled={locked}
            aria-label={`${body.visible ? 'Hide' : 'Show'} ${body.name}`} aria-pressed={body.visible}
            title={state.bodiesHidden ? 'All CAD bodies are hidden in the viewport view controls.' : `${body.visible ? 'Hide' : 'Show'} ${body.name}`}
            onClick={() => state.toggleBodyVisible(body.id)}><Icon name={body.visible ? 'eye' : 'eyeOff'} size={15} /></button>
          <button type="button" className="explorer-item" disabled={locked} data-test={`explorer-body-${body.id}`}
            title={`${location ? `${location} / ` : ''}${body.name} · ${body.surface ? 'surface' : 'solid'} · click to select, double-click to edit its feature`}
            onClick={(event) => {
              let next = [body.id]
              if (event.ctrlKey || event.metaKey) next = picked.includes(body.id) ? picked.filter((id) => id !== body.id) : [...picked, body.id]
              else if (event.shiftKey && picked.length > 0) {
                const anchor = state.bodies.findIndex((b) => b.id === picked[picked.length - 1])
                if (anchor >= 0) next = state.bodies.slice(Math.min(anchor, index), Math.max(anchor, index) + 1).map((b) => b.id)
              }
              state.setListSelection({ bodies: next, folders: [] })
            }}
            onDoubleClick={() => { if (!locked) openFeatureEditor(bodyMaker(body.id)) }}>
            <span className="explorer-icon" style={{ color: body.color ?? bodyColor(body.id) }}><Icon name={body.surface ? 'sheet' : 'model'} size={16} /></span>
            <span>{body.name}</span><small>{body.surface ? 'surface' : 'solid'}</small>
          </button>
        </div>
      })}
    </div>
  </details>
}

export function ReverseHistory() {
  const { state, locked } = useExplorerLocked()
  const all = [...state.features, ...state.rolledBack]
  return <details className="explorer-group" open data-test="explorer-cad-history">
    <summary><span>Feature history</span><small>{all.length}</small></summary>
    <div className="explorer-children">
      {all.length === 0 && <p className="explorer-empty">CAD features appear here in build order.</p>}
      {all.map((feature, index) => {
        const rolled = index >= state.features.length
        return <div className="explorer-row" key={feature.id}>
          <button type="button" className="explorer-item" disabled={locked || rolled} data-test={`explorer-feature-${feature.id}`}
            title={rolled ? 'Below the rollback bar. Restore it in the tool panel to edit.' : locked ? 'Finish the current operation before editing a feature.' : `${feature.name} · click to edit this feature`}
            onClick={() => openFeatureEditor(feature.id)}>
            <span className="explorer-icon"><KeyIcon name={FEATURE_ICONS[feature.kind]} size={16} /></span>
            <span>{feature.name}</span><small>{rolled ? 'rolled back' : feature.suppressed ? 'suppressed' : feature.kind}</small>
          </button>
        </div>
      })}
    </div>
  </details>
}
