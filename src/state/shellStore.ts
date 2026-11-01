// SPDX-License-Identifier: AGPL-3.0-only
// Which workspace is on screen. This is the one piece of state every part of
// the app reads — the top bar to draw the switch, the panels to know which of
// them is up, the scene sync to know what belongs on the part — so it lives in
// a store of its own rather than inside any one workspace's state, where the
// others would have to reach for it.

import { create } from 'zustand'

/** The things this tool does of itself. The mesh workspaces share the scan,
 *  the scene and the camera, differing only in what is drawn on top of the
 *  part; the flat workspace measures a 2D scan image in a viewport of its
 *  own. */
export type CoreWorkspace = 'elements' | 'deviation' | 'thickness' | 'flat'

export const CORE_WORKSPACES: readonly CoreWorkspace[] = ['elements', 'deviation', 'thickness', 'flat']

/** A core workspace, or one a plugin adds under its own id — see
 *  plugins/api.ts. */
export type Workspace = CoreWorkspace | (string & {})

interface ShellState {
  workspace: Workspace
  ribbonTab: string
  setRibbonTab: (tab: string, workspace?: Workspace) => void
  setWorkspace: (w: Workspace) => void
  inspectorOpen: boolean
  /** The application menu opened from the Quick Scan mark (ui/AppMenu). */
  appMenuOpen: boolean
  /** The Extract primitives dialog (ui/ExtractPrimitives) is open. */
  extractOpen: boolean
  setExtractOpen: (open: boolean) => void
  setAppMenuOpen: (open: boolean) => void
  inspectorMode: 'floating' | 'docked'
  setInspectorOpen: (open: boolean) => void
  setInspectorMode: (mode: 'floating' | 'docked') => void
}

export const useShell = create<ShellState>()((set) => ({
  workspace: 'elements',
  ribbonTab: 'main',
  inspectorOpen: true,
  appMenuOpen: false,
  extractOpen: false,
  setExtractOpen: (extractOpen) => set({ extractOpen, ...(extractOpen ? { inspectorOpen: true } : {}) }),
  setAppMenuOpen: (appMenuOpen) => set({ appMenuOpen }),
  inspectorMode: 'floating',
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
  setInspectorMode: (inspectorMode) => set({ inspectorMode, inspectorOpen: true }),
  setRibbonTab: (ribbonTab, workspace) => set({ ribbonTab, inspectorOpen: true, ...(workspace ? { workspace } : {}) }),
  setWorkspace: (workspace) => set({ workspace, inspectorOpen: true, ribbonTab: ({ elements: 'main', reverse: 'cad', mesh: 'scan', deviation: 'analysis', thickness: 'thickness', flat: 'flat' } as Record<string, string>)[workspace] ?? workspace }),
}))
