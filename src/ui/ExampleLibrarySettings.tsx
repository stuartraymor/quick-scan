// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react'
import { libraryBridge, libraryChanged, type Library } from '../app/referenceExamples'

export function ExampleLibrarySettings({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [library, setLibrary] = useState<Library>()
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const bridge = libraryBridge()
  useEffect(() => {
    let active = true
    const el = dialog.current!
    el.showModal()
    Promise.resolve(bridge?.exampleLibrary?.()).then(value => { if (active) setLibrary(value) })
      .catch(() => { if (active) setError('Could not read the example folder.') })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false; el.close() }
  }, [bridge])
  async function change(action: 'browse' | 'refresh' | 'clear') {
    setBusy(true)
    setError('')
    try {
      if (action === 'browse' && !await bridge?.chooseExamples?.()) return
      if (action === 'clear') await bridge?.clearExamples?.()
      setLibrary(await bridge?.exampleLibrary?.())
      window.dispatchEvent(new Event(libraryChanged))
    } catch { setError('Could not read or save this folder. Check its location and try again.') }
    finally { setBusy(false) }
  }
  return <dialog ref={dialog} className="example-settings" aria-labelledby="example-settings-title"
    onCancel={e => { e.preventDefault(); onClose() }}>
    <h2 id="example-settings-title">Settings</h2>
    <h3>Example library</h3>
    <p>Choose a folder for Help &gt; Examples. Match a part by its file name, or place one model in a folder named after the part. Other models appear under My examples.</p>
    <p>Supported files: STL, OBJ, PLY and 3MF, including subfolders.</p>
    <strong>Mapped folder</strong>
    <div data-test="library-path" className="library-path">{library?.folder || 'No folder mapped'}</div>
    <p role="status">{error || (!bridge?.exampleLibrary ? 'Folder mapping is available in the desktop app.' : busy ? 'Reading folder...' : library?.unavailable ? 'Folder unavailable. Reconnect it or choose another folder.' : library?.folder ? library.entries.length + ' models found' + (library.truncated ? ' (scan limit reached)' : '') : 'The three included examples are always available.')}</p>
    <div className="library-actions">
      <button disabled={busy || !bridge?.chooseExamples} onClick={() => void change('browse')}>Browse...</button>
      <button disabled={busy || !library?.folder} onClick={() => void change('refresh')}>Refresh</button>
      <button disabled={busy || !library?.folder} title="Forget this folder without deleting any files" onClick={() => void change('clear')}>Clear mapping</button>
      <button onClick={onClose}>Close</button>
    </div>
  </dialog>
}
