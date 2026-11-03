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
  /** What is selected in the Objects tree and by a box drawn on the stage:
   *  'scan', 'element:<id>', 'section:<id>'. */
  selection: string[]
  /** The point on the scan under a client position, from the main viewport —
   *  for a one-click pick in a dialog (Align's Translate Pick…). */
  scanPointAt: ((x: number, y: number) => [number, number, number] | null) | null
  setSelection: (keys: string[]) => void
  /** Triangles of the scan hidden by Hide Selected / Isolate (a view state). */
  hiddenTriangles: number
  setHiddenTriangles: (n: number) => void
  setExtractOpen: (open: boolean) => void
  /** The Prepare Scan wizard's step (0–3), or null when it is not running. */
  prepareStep: number | null
  setPrepareStep: (step: number | null) => void
  setAppMenuOpen: (open: boolean) => void
  inspectorMode: 'floating' | 'docked'
  setInspectorOpen: (open: boolean) => void
  setInspectorMode: (mode: 'floating' | 'docked') => void
  /** Help > Reset layout: back to the Main tab, the tool panel open and floating. */
  resetLayout: () => void
}

export const useShell = create<ShellState>()((set) => ({
  workspace: 'elements',
  ribbonTab: 'main',
  inspectorOpen: true,
  appMenuOpen: false,
  extractOpen: false,
  selection: [],
  scanPointAt: null,
  setSelection: (selection) => set({ selection }),
  prepareStep: null,
  setPrepareStep: (prepareStep) => set({ prepareStep }),
  hiddenTriangles: 0,
  setHiddenTriangles: (hiddenTriangles) => set({ hiddenTriangles }),
  setExtractOpen: (extractOpen) => set({ extractOpen, ...(extractOpen ? { inspectorOpen: true } : {}) }),
  setAppMenuOpen: (appMenuOpen) => set({ appMenuOpen }),
  inspectorMode: 'floating',
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
  resetLayout: () => set({ ribbonTab: 'main', workspace: 'elements', inspectorMode: 'floating', inspectorOpen: true, appMenuOpen: false }),
  setInspectorMode: (inspectorMode) => set({ inspectorMode, inspectorOpen: true }),
  setRibbonTab: (ribbonTab, workspace) => set({ ribbonTab, inspectorOpen: true, ...(workspace ? { workspace } : {}) }),
  // Starting a command keeps the ribbon tab it was started from, as in QUICKSURFACE.
  setWorkspace: (workspace) => set({ workspace, inspectorOpen: true }),
}))
