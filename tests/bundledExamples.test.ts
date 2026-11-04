// SPDX-License-Identifier: AGPL-3.0-only
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {it,expect} from 'vitest'
import bundled from '../src/app/bundledExamples.json'

for (const item of bundled) it('ships the offline sample ' + item.label, () => {
  const bytes = readFileSync(new URL('../public/samples/' + item.file, import.meta.url))
  expect(bytes.length).toBe(item.bytes)
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(item.sha256)
})
