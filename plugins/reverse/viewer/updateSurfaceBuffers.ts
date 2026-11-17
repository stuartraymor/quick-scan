// SPDX-License-Identifier: AGPL-3.0-only
import * as THREE from 'three'

/** Keep WebGL storage for a fixed layout; upload only the changed interval.
 * The renderer owns its arrays, so measurement snapshots remain immutable. */
export function updateSurfaceAttribute(geometry: THREE.BufferGeometry, name: string, values: Float32Array | Uint32Array, itemSize: number) {
  const previous = (name === 'index' ? geometry.getIndex() : geometry.getAttribute(name)) as THREE.BufferAttribute | undefined
  if (!previous || previous.itemSize !== itemSize || previous.array.constructor !== values.constructor || previous.array.length !== values.length) {
    const attribute = new THREE.BufferAttribute(values.slice(), itemSize).setUsage(THREE.DynamicDrawUsage)
    if (name === 'index') geometry.setIndex(attribute)
    else geometry.setAttribute(name, attribute)
    return
  }
  let first = values.length, last = -1
  for (let i = 0; i < values.length; i++) if (previous.array[i] !== values[i]) {
    previous.array[i] = values[i]; first = Math.min(first, i); last = i
  }
  if (last >= first) {
    // Do not clear pending ranges: more than one update can precede a frame.
    previous.addUpdateRange(first, last - first + 1)
    previous.needsUpdate = true
  }
}
