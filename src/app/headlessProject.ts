// SPDX-License-Identifier: AGPL-3.0-only
// The project verbs for a session without a browser — a test, or the MCP
// kit's own session: the same open and save as the app's (projectIo), on the
// archive functions in-thread instead of the project worker, with no
// recovery checkpoint and nobody to ask before work is lost (a caller passes
// `discard` instead). An image on the 2D sheet needs the browser's bitmap
// decoder, so a project holding one does not open here.

import { packProject, unpackProject } from '../core/project/archive'
import type { ProjectHost } from '../commands/host'
import type { AppSession } from './session'
import { createProjectIo, noSavedWatch, type ProjectIo, type ProjectIoDeps } from './projectIo'

export function headlessProjectIo(session: AppSession, overrides: Partial<ProjectIoDeps> = {}): ProjectIo {
  return createProjectIo({
    sources: session.sources,
    clientRef: session.clientRef,
    sceneRef: session.sceneRef,
    elementScope: session.maps.elementScope,
    imports: session.imports,
    commitScan: session.scan.commitScan,
    commitNominal: session.deviation.commitNominal,
    commitImage: (image) => { if (image) throw new Error('A project with an image on the 2D sheet needs the browser to open.') },
    runEdgeDetect: async () => {},
    runFit: session.measure.runFit,
    runDeviation: session.deviation.runDeviation,
    runThickness: session.thickness.runThickness,
    archive: {
      pack: async (manifest, members) => packProject(manifest, members),
      unpack: async (bytes) => unpackProject(bytes),
    },
    saved: noSavedWatch,
    download: () => {},
    confirm: () => false,
    ...overrides,
  })
}

/** The verbs project.save and project.load run through, headless. */
export function headlessProjectHost(session: AppSession): ProjectHost {
  const io = headlessProjectIo(session)
  return {
    save: io.packProject,
    open: (file, discard) => io.openProject(file, false, discard),
  }
}
