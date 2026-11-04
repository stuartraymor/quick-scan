// SPDX-License-Identifier: AGPL-3.0-only
import catalog from './referenceExamples.json'
import bundled from './bundledExamples.json'

export type LocalModel = {key:string;file:string;label:string}
export interface Library {folder:string; entries:LocalModel[];slots:Record<string, LocalModel & {verify:boolean}>;truncated?:boolean;unavailable?:boolean}
export const libraryBridge=()=> (window as unknown as {quickScanFiles?: {exampleLibrary?:()=>Promise<Library>;chooseExamples?:()=>Promise<boolean>;clearExamples?:()=>Promise<void>}}).quickScanFiles
export const libraryChanged='quickscan:example-library-changed'
export function localFolderPicker() {
  return (window as unknown as { quickScanFiles?: {chooseExamples?: () => Promise<boolean>} }).quickScanFiles?.chooseExamples
}
export const REFERENCE_CATALOG = catalog
export const BUNDLED_EXAMPLES = bundled
export async function installedExamples(base = import.meta.env.BASE_URL) {
  const files = (window as unknown as {quickScanFiles?: {examples?: () => Promise<string[]>}}).quickScanFiles
  if (files?.examples) {
    const names = await files.examples()
    return catalog.filter(item => names.includes(item.file))
  }
  // A web deployment may optionally serve local reference models. A Vite
  // fallback HTML page is not evidence that a model is present.
  const available = await Promise.all(catalog.map(async item => {
    try {
      const r = await fetch(base.replace(/\/*$/, '/') + 'reference-examples/' + item.file, {method: 'HEAD'})
      return r.ok && Number(r.headers.get('content-length')) === item.bytes
    } catch { return false }
  }))
  return catalog.filter((_, i) => available[i])
}

export async function fetchReferenceExample(id: string, base: string = import.meta.env.BASE_URL): Promise<File> {
  if(id.startsWith('local:')){
    const [,key,...file]=id.split(':')
    const response=await fetch(base.replace(/\/*$/, '/')+'mapped-examples/'+key)
    if(!response.ok)throw Error('Example file is unavailable. Refresh the mapped folder in Settings.')
    return new File([await response.blob()],file.join(':'))
  }
  const sample = bundled.find(item => item.id === id)
  const item = sample ?? catalog.find(item => item.id === id)
  if (!item) throw new Error('Unknown example model.')
  const dir = sample ? 'samples' : 'reference-examples'
  const response = await fetch(base.replace(/\/*$/, '/') + dir + '/' + item.file)
  if (!response.ok) throw new Error(sample ? 'The bundled example is missing. Reinstall Quick Scan.' : item.label + ' is unavailable. Restore the local example file.')
  const bytes = await response.arrayBuffer()
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
  if (bytes.byteLength !== item.bytes || hash !== item.sha256) throw new Error(item.label + ' does not match the expected example file.')
  return new File([bytes], item.file, { type: item.file.endsWith('.3mf') ? 'model/3mf' : 'model/stl' })
}
