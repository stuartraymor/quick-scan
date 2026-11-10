// SPDX-License-Identifier: AGPL-3.0-only
// Plugins may convert a foreign project to the normal, validated project
// representation. Conversion must finish before any live document is changed.
import type { UnpackedProject } from '../core/project/archive'
export interface ProjectReader {
  extension: string
  label: string
  read(bytes: Uint8Array, name: string): Promise<UnpackedProject>
  /** Finish derived geometry before framing a newly converted document. */
  settled?(): Promise<void>
}
const readers = new Map<string, ProjectReader>()
export function registerProjectReader(reader: ProjectReader): () => void {
  const extension = reader.extension.toLowerCase()
  if (!/^\.[a-z0-9]+$/.test(extension) || extension === '.scanruler') throw Error('Invalid foreign project extension.')
  if (readers.has(extension)) throw Error(`Duplicate project reader for ${extension}.`)
  readers.set(extension, reader)
  return () => { if (readers.get(extension) === reader) readers.delete(extension) }
}
export const projectReaderFor = (name: string): ProjectReader | undefined => readers.get(/\.[^.\\/]+$/.exec(name.toLowerCase())?.[0] ?? '')
export const foreignProjectAccept = (): string => [...readers.keys()].join(',')
