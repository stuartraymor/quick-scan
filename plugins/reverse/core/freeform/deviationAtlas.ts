// SPDX-License-Identifier: AGPL-3.0-only
/** Pack complete face charts into columns without interpolation across seams.
 *  WebGL2 guarantees at least 2048 texels per dimension. */
export function deviationAtlas(size: number, faces: number, limit = 2048) {
  if (!Number.isInteger(size) || size < 2 || !Number.isInteger(faces) || faces < 1) throw new Error('Invalid deviation chart dimensions.')
  const capacity = Math.floor(limit / size)
  if (capacity < 1 || faces > capacity * capacity) throw new Error('Deviation chart exceeds texture capacity.')
  const columns = Math.ceil(faces / capacity), rows = Math.ceil(faces / columns)
  return {columns, width:columns * size, height:rows * size}
}

/** Original samples remain face-major; only GPU storage is tiled. */
export function deviationAtlasValues(values: Float32Array, size: number, faces: number, tolerance: number) {
  if (values.length !== size * size * faces || !(tolerance > 0)) throw new Error('Invalid deviation chart samples.')
  const layout = deviationAtlas(size, faces), data = new Float32Array(layout.width * layout.height)
  for (let face = 0; face < faces; face++) {
    const x = face % layout.columns * size, y = Math.floor(face / layout.columns) * size
    for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
      data[(y + row) * layout.width + x + col] = -values[(face * size + row) * size + col] / tolerance
    }
  }
  return {...layout, data}
}
