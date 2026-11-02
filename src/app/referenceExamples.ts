// SPDX-License-Identifier: AGPL-3.0-only
import catalog from './referenceExamples.json'
/** Labels and order observed in the installed reference Help > Examples menu. */
export const REFERENCE_EXAMPLES = catalog
export async function fetchReferenceExample(id: string, base: string = import.meta.env.BASE_URL): Promise<File> {
  const item = catalog.find(item => item.id === id)
  if (!item) throw new Error('Unknown example model.')
  const response = await fetch(`${base.replace(/\/*$/, '/')}reference-examples/${item.file}`)
  if (!response.ok) throw new Error(`${item.label} is unavailable in this build. The local example files must be installed.`)
  const bytes = await response.arrayBuffer()
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
  if (bytes.byteLength !== item.bytes || hash !== item.sha256) throw new Error(`${item.label} does not match the reference example file. Restore the original local example.`)
  return new File([bytes], item.file, { type: 'model/stl' })
}
