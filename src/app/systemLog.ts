// SPDX-License-Identifier: AGPL-3.0-only
// Help > System Log: what the app has said about itself since it started —
// warnings and errors from the console, uncaught errors and rejected promises —
// kept in a ring so a long session does not grow it without bound. Local only:
// nothing here is sent anywhere.

import { create } from 'zustand'

const LIMIT = 500

interface LogState {
  lines: string[]
  add: (level: string, text: string) => void
  clear: () => void
}

const stamp = () => new Date().toTimeString().slice(0, 8)

export const useSystemLog = create<LogState>()((set) => ({
  lines: [],
  add: (level, text) =>
    set((s) => ({ lines: [...s.lines, `${stamp()}  ${level}  ${text}`].slice(-LIMIT) })),
  clear: () => set({ lines: [] }),
}))

const show = (args: unknown[]) =>
  args.map((a) => (a instanceof Error ? a.stack ?? a.message : typeof a === 'string' ? a : safeJson(a))).join(' ')

const safeJson = (v: unknown): string => {
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return String(v)
  }
}

let installed = false

/** Start collecting. Safe to call twice (StrictMode, hot reload). */
export function installSystemLog(version: string): void {
  if (installed) return
  installed = true
  const { add } = useSystemLog.getState()
  add('INFO', `Quick Scan ${version} started`)
  for (const level of ['warn', 'error'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      add(level === 'warn' ? 'WARN' : 'ERROR', show(args))
      original(...args)
    }
  }
  window.addEventListener('error', (e) => add('ERROR', `${e.message} (${e.filename}:${e.lineno})`))
  window.addEventListener('unhandledrejection', (e) => add('ERROR', `Unhandled rejection: ${show([e.reason])}`))
}
