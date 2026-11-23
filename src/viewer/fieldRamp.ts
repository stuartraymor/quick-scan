// SPDX-License-Identifier: AGPL-3.0-only
// A measured reading on some of the scan's vertices, coloured per fragment.
//
// Vertex colours are interpolated across a triangle as colours: between a
// red corner and a blue one the face runs through purple, a colour the ramp
// never gives, and a large triangle on a flat face shows as a patch of its
// own. Here the reading itself is interpolated and the ramp is read at every
// fragment, so the map's contours run smoothly across the triangles, and the
// colour at a point is the one its interpolated reading deserves. A real
// step in the reading — past the range, onto a cap — stays a step: the caps
// are not blended into the ramp.
//
// Two attributes carry it, both zero where nothing was read: `fieldW`, one
// on a read vertex, and `fieldV`, the reading times that weight. Their
// interpolated ratio is the reading weighted over the read corners only, so
// a triangle with an unread corner shows the read corners' reading, faded
// into the surface by the weight — the map's edge, softened over one ring of
// triangles instead of cut along their edges.

import * as THREE from 'three'
import { rampColor, scaleCaps, type Colormap, type FieldScale } from '../core/field/colormap'

export interface FieldRampUniforms {
  uFieldRamp: { value: THREE.DataTexture }
  uFieldLow: { value: number }
  uFieldHigh: { value: number }
  uFieldCapLow: { value: THREE.Color }
  uFieldCapHigh: { value: THREE.Color }
  uFieldBands: { value: number }
  uFieldReversed: { value: number }
}

const RAMP_TEXELS = 256

export function fieldRampUniforms(): FieldRampUniforms {
  const texture = new THREE.DataTexture(new Uint8Array(RAMP_TEXELS * 4), RAMP_TEXELS, 1, THREE.RGBAFormat)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.colorSpace = THREE.NoColorSpace
  texture.needsUpdate = true
  return {
    uFieldRamp: { value: texture },
    uFieldLow: { value: -1 },
    uFieldHigh: { value: 1 },
    uFieldCapLow: { value: new THREE.Color(0, 0, 1) },
    uFieldCapHigh: { value: new THREE.Color(1, 0, 0) },
    uFieldBands: { value: 0 },
    uFieldReversed: { value: 0 },
  }
}

/** Set the ramp, caps and scale the map is read with. The ramp's bytes are
 *  the vertex colours' — the working colour space, unconverted — so the map
 *  reads the same colours paintField writes. */
export function setFieldRamp(u: FieldRampUniforms, scale: FieldScale, map: Colormap): void {
  const data = u.uFieldRamp.value.image.data as Uint8Array
  const rgb: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < RAMP_TEXELS; i++) {
    rampColor(map, i / (RAMP_TEXELS - 1), rgb)
    data[i * 4] = rgb[0]
    data[i * 4 + 1] = rgb[1]
    data[i * 4 + 2] = rgb[2]
    data[i * 4 + 3] = 255
  }
  u.uFieldRamp.value.needsUpdate = true
  const caps = scaleCaps(scale, map)
  u.uFieldCapLow.value.setRGB(caps.low[0] / 255, caps.low[1] / 255, caps.low[2] / 255, THREE.LinearSRGBColorSpace)
  u.uFieldCapHigh.value.setRGB(caps.high[0] / 255, caps.high[1] / 255, caps.high[2] / 255, THREE.LinearSRGBColorSpace)
  u.uFieldLow.value = scale.low
  u.uFieldHigh.value = scale.high
  u.uFieldBands.value = scale.bands && scale.bands >= 2 ? scale.bands : 0
  u.uFieldReversed.value = scale.reversed ? 1 : 0
}

export const FIELD_GLSL_VERTEX = 'attribute float fieldW;\nattribute float fieldV;\nvarying float vFieldW;\nvarying float vFieldV;\n'
export const FIELD_GLSL_VERTEX_BODY = 'vFieldW = fieldW;\nvFieldV = fieldV;'
export const FIELD_GLSL_PREAMBLE = `uniform sampler2D uFieldRamp;
uniform float uFieldLow;
uniform float uFieldHigh;
uniform vec3 uFieldCapLow;
uniform vec3 uFieldCapHigh;
uniform float uFieldBands;
uniform float uFieldReversed;
varying float vFieldW;
varying float vFieldV;
vec3 fieldRampColor(float v) {
  float span = uFieldHigh - uFieldLow;
  float t = span > 0.0 ? (v - uFieldLow) / span : 0.5;
  if (t < 0.0) return uFieldReversed > 0.5 ? uFieldCapHigh : uFieldCapLow;
  if (t > 1.0) return uFieldReversed > 0.5 ? uFieldCapLow : uFieldCapHigh;
  if (uFieldReversed > 0.5) t = 1.0 - t;
  if (uFieldBands >= 2.0) t = (min(uFieldBands - 1.0, floor(t * uFieldBands)) + 0.5) / uFieldBands;
  return texture2D(uFieldRamp, vec2(t * ${((RAMP_TEXELS - 1) / RAMP_TEXELS).toFixed(6)} + ${(0.5 / RAMP_TEXELS).toFixed(6)}, 0.5)).rgb;
}
`
/** Spliced after the element tints' border cut: over a read triangle the
 *  ramp at the interpolated reading; at the map's edge, faded into what the
 *  layers below left. */
export const FIELD_GLSL_FRAGMENT = `if (vFieldW > 0.002) {
  vec3 fieldColor = fieldRampColor(vFieldV / vFieldW);
  diffuseColor.rgb = mix(diffuseColor.rgb, fieldColor, smoothstep(0.0, 1.0, vFieldW));
}`
