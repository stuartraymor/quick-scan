// SPDX-License-Identifier: AGPL-3.0-only
// "Check for updates" in the application menu of the Windows app: asks the
// latest GitHub release, downloads and verifies it, then restarts into the
// installer. Absent in the browser, where no updater bridge exists.
import { useEffect, useState } from 'react'

type Bridge = {
  check(): Promise<{ status: string; version?: string; detail?: string }>
  download(): Promise<{ status: string; detail?: string }>
  install(): Promise<{ status: string }>
  onProgress(cb: (p: number) => void): () => void
}
const bridge = (): Bridge | undefined => (window as unknown as { quickScanUpdater?: Bridge }).quickScanUpdater

type Phase =
  | { kind: 'idle' | 'checking' | 'current' | 'ready' | 'installing' }
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; pct: number }
  | { kind: 'error'; detail: string }

/** The updater's state and the one action that moves it on; null in a browser. */
export function useUpdater() {
  const api = bridge()
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  useEffect(() => api?.onProgress((p) => setPhase({ kind: 'downloading', pct: Math.round(p * 100) })), [api])
  if (!api) return null
  const check = async () => {
    setPhase({ kind: 'checking' })
    const r = await api.check()
    setPhase(
      r.status === 'available' && r.version
        ? { kind: 'available', version: r.version }
        : r.status === 'error'
          ? { kind: 'error', detail: r.detail ?? 'Update check failed.' }
          : { kind: 'current' },
    )
  }
  const download = async () => {
    setPhase({ kind: 'downloading', pct: 0 })
    const r = await api.download()
    setPhase(r.status === 'ready' ? { kind: 'ready' } : { kind: 'error', detail: r.detail ?? 'Download failed.' })
  }
  const label =
    phase.kind === 'available'
      ? `Update to v${phase.version}`
      : phase.kind === 'downloading'
        ? `Downloading ${phase.pct}%`
        : { idle: 'Check for updates', checking: 'Checking…', current: 'Up to date', ready: 'Restart to update', installing: 'Installing…', error: 'Retry update' }[phase.kind]
  const busy = phase.kind === 'checking' || phase.kind === 'downloading' || phase.kind === 'installing'
  const run =
    phase.kind === 'available'
      ? download
      : phase.kind === 'ready'
        ? () => {
            setPhase({ kind: 'installing' })
            void api.install()
          }
        : check
  return {
    phase,
    label,
    busy,
    run,
    title: phase.kind === 'error' ? phase.detail : 'Check the latest GitHub release and update Quick Scan automatically',
  }
}
