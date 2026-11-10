// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it, vi } from 'vitest'
import { foreignProjectAccept, projectReaderFor, registerProjectReader } from '../src/app/projectReaders'
it('routes exact case-insensitive extensions and unregisters only its own reader', () => {
  const reader = { extension: '.qsf', label: 'QuickSurface', read: vi.fn() }
  const remove = registerProjectReader(reader)
  try {
    expect(projectReaderFor('Part.QSF')).toBe(reader)
    expect(projectReaderFor('part.qsf.scanruler')).toBeUndefined()
    expect(projectReaderFor('folder.qsf/file')).toBeUndefined()
    expect(foreignProjectAccept()).toContain('.qsf')
    expect(() => registerProjectReader(reader)).toThrow('Duplicate')
  } finally { remove() }
  expect(projectReaderFor('part.qsf')).toBeUndefined()
})
it('cannot replace native project parsing or register a path as an extension', () => {
  for (const extension of ['.scanruler', '../qsf', 'qsf']) expect(() => registerProjectReader({ extension, label: 'invalid', read: vi.fn() })).toThrow()
})
