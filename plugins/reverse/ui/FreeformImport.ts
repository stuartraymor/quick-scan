// SPDX-License-Identifier: AGPL-3.0-only
import { runCommand } from '../../../src/commands/registry'
import { useStore } from '../../../src/state/store'
import { reEditorOpen, useReverse } from '../state/reStore'

/** The ribbon imports through the same validated transaction as MCP. */
export async function importFreeformObjFile(file: Pick<File, 'name' | 'text'>): Promise<void> {
  const status = (text: string) => useStore.getState().setStatus(text)
  try {
    const obj = await file.text(), current = useReverse.getState()
    if (useStore.getState().busy || current.building || current.playback !== null || reEditorOpen(current)) {
      status('Finish the current operation before importing a freeform cage.')
      return
    }
    status(`Reading freeform cage from ${file.name}…`)
    await runCommand('reverse.freeform.create', { obj }, status)
    status(`Imported freeform cage from ${file.name}.`)
  } catch (error) {
    status(`Could not import freeform cage: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function chooseFreeformObj(): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.obj'
  input.hidden = true
  input.dataset.test = 'freeform-obj-input'
  const remove = () => input.remove()
  input.addEventListener('cancel', remove, { once: true })
  input.addEventListener('change', () => {
    const file = input.files?.[0]
    remove()
    if (file) void importFreeformObjFile(file)
  }, { once: true })
  document.body.append(input)
  input.click()
}
