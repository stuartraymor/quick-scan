// SPDX-License-Identifier: AGPL-3.0-only
// Files reconstructed from Recent Documents lose their native File identity. The
// main process issues this opaque token only after reading that particular file.
export const recentProjectTargets = new WeakMap<File, string>()
export interface ProjectWriter {
  saveProject(name: string, bytes: Uint8Array, saveAs: boolean, token: string | null, file: File | null):
    Promise<{ canceled: true } | { canceled: false; name: string; token: string }>
}
export const desktopProjectWriter = () => (window as Window & { quickScanFiles?: ProjectWriter }).quickScanFiles
