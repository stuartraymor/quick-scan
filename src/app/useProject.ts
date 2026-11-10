// SPDX-License-Identifier: AGPL-3.0-only
// The app's project verbs: projectIo (the one copy of open, save and new,
// shared with headless sessions) on the project worker, with the recovery
// checkpoint watching for unsaved work and the desktop's native writer when
// there is one.

import { useEffect, useRef, useState, type RefObject } from 'react'
import type { ElementKind } from '../core/types'
import type { MeshWorkerClient } from '../core/workerClient'
import type { SceneManager } from '../viewer/SceneManager'
import { ProjectClient } from '../core/project/projectClient'
import { useStore } from '../state/store'
import { PROJECT_EXTENSION } from '../core/project/manifest'
import { desktopProjectWriter } from './projectWriter'
import { type SourceFiles } from './project'
import { useRecovery } from './useRecovery'
import type { ImportQueue } from './importQueue'
import type { PreparedScan, PreparedNominal, PreparedImage } from './imports'
import { createProjectIo, type ProjectIo, type SavedWatch } from './projectIo'
import { projectReaderFor } from './projectReaders'

export const isProjectFile = (name: string) =>
  name.toLowerCase().endsWith(`.${PROJECT_EXTENSION}`) || projectReaderFor(name) !== undefined

export function useProject(deps: {
  sources: RefObject<SourceFiles>
  clientRef: RefObject<MeshWorkerClient | null>
  sceneRef: RefObject<SceneManager | null>
  elementScope: RefObject<Uint32Array | null>
  imports: ImportQueue
  commitScan: (scan: PreparedScan | null) => void
  commitNominal: (nominal: PreparedNominal | null) => void
  commitImage: (image: PreparedImage | null) => void
  runEdgeDetect: () => Promise<void>
  runFit: (id: number, kind: ElementKind, seeds: number[], selection?: Uint32Array, regionsOnly?: boolean) => Promise<void>
  runDeviation: () => Promise<void>
  runThickness: () => Promise<void>
}) {
  const projectClient = useRef<ProjectClient | null>(null)
  const client = () => (projectClient.current ??= new ProjectClient())
  // The recovery hook needs capture, which the io owns, and the io needs the
  // recovery's marks: the marks go through a ref filled in once both exist.
  const recoveryRef = useRef<ReturnType<typeof useRecovery> | null>(null)
  const saved: SavedWatch = {
    markSaved: (s) => recoveryRef.current?.markSaved(s),
    restored: () => recoveryRef.current?.restored(),
    dirty: () => recoveryRef.current?.dirty ?? false,
  }
  const [io] = useState<ProjectIo>(() => createProjectIo({
    ...deps,
    archive: {
      pack: (manifest, members) => client().pack(manifest, members),
      unpack: (bytes) => client().unpack(bytes),
      failed: () => { if (projectClient.current?.dead) projectClient.current = null },
    },
    saved,
    writer: desktopProjectWriter,
    confirm: (message) => window.confirm(message),
  }))
  const recovery = useRecovery(io.capture, () => deps.imports.busy || useStore.getState().busy, (file) => io.openProject(file, true))
  recoveryRef.current = recovery
  useEffect(() => () => projectClient.current?.dispose(), [])

  return { saveProject: io.saveProject, saveProjectAs: io.saveProjectAs, packProject: io.packProject, openProject: io.openProject, newProject: io.newProject, recovery }
}
