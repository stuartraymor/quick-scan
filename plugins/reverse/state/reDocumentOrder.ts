// SPDX-License-Identifier: AGPL-3.0-only
import { DOCUMENT_HISTORY_READ_ONLY, type DocumentOrderProvider } from '../../../src/state/documentOrderStore'
import { useReverse } from './reStore'

// Worker results, cancellation, selection and view switches remain available
// while the common timeline is partial. Modeling entrypoints are guarded.
const nonModelActions = new Set([
  'setKernel', 'beginBuild', 'finishBuild', 'failBuild', 'setElementRefs', 'setChains', 'setHint', 'setPreview',
  'setBodyMap', 'setCurvatureMap', 'setCurvature', 'setCurvatureShown', 'setMapReport',
  'setSelection', 'pickBodyItem', 'addBodyItems', 'setListSelection', 'setBodyHover', 'setBodyPick', 'clearSelection',
  'setScanHidden', 'setBodiesHidden', 'setScanSeeThrough', 'setBodiesSeeThrough', 'setTangentEdges',
  'setOverlapsShown', 'setElementsShown', 'setPlaneShown', 'setSketchModelShown', 'setSketchSliced', 'setFolderOpen',
  'setGripField', 'canUndo', 'canRedo', 'reset', 'discardSketch', 'cancelExtrude', 'cancelRevolve', 'cancelFeature', 'cancelSketchPattern',
  'toggleBodyVisible', 'setAllBodiesVisible', 'setBodiesVisible', 'toggleFeatureVisible',
])

export const reverseDocumentOrderProvider: DocumentOrderProvider = {
  id: 'reverse',
  keys: () => [...useReverse.getState().features, ...useReverse.getState().rolledBack].map((feature) => `reverse:feature:${feature.id}`),
  subscribe: (changed) => useReverse.subscribe((s, prev) => { if (s.features !== prev.features || s.rolledBack !== prev.rolledBack) changed() }),
  projectKeys: (manifest) => {
    const part = manifest.reverse as { features?: { id: number }[] } | undefined
    return Array.isArray(part?.features) ? part.features.map((feature) => `reverse:feature:${feature.id}`) : []
  },
  rollTo: (activeKeys) => useReverse.getState().rollTo(activeKeys.length),
  mutationActions: {
    store: useReverse,
    names: Object.entries(useReverse.getState()).filter(([name, value]) => typeof value === 'function' && !nonModelActions.has(name)).map(([name]) => name),
    rollAction: 'rollTo',
    refused: {
      startSketchOn: false, setSketchAngle: false, moveToBodyFolder: false,
      commitSketch: null, commitExtrude: null, commitRevolve: null, commitFeature: null, addParameter: null, addBodyFolder: null,
      moveFeatures: DOCUMENT_HISTORY_READ_ONLY, setParameter: DOCUMENT_HISTORY_READ_ONLY, removeParameter: DOCUMENT_HISTORY_READ_ONLY,
      extrudeToPoint: DOCUMENT_HISTORY_READ_ONLY, setSuppressed: [],
    },
  },
}
