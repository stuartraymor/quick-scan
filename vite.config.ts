// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync, realpathSync } from 'node:fs'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// The version the app reports is the one package.json carries, read here and
// substituted at build time — so bumping that one field is the whole of a
// release, and no source file has a number to forget.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

// node_modules may be a link into another checkout (the work copy shares
// ScanRuler's). Vite then sees package files at their real location, outside
// this root, and refuses to serve them (a package's .wasm?url, say); the real
// folder is allowed by name so a linked install behaves like a local one.
let linkedModules: string[] = []
try {
  linkedModules = [realpathSync(new URL('./node_modules', import.meta.url))]
} catch {
  /* no node_modules yet */
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    fs: { allow: ['.', ...linkedModules] },
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
  // The workers are module workers already (`type: 'module'` everywhere they
  // are made), and a worker may load a large package with a dynamic import
  // so that it is fetched only when it is needed — which needs a worker
  // bundle that can split.
  worker: {
    format: 'es',
  },
  // The dev server's dependency scan starts from index.html and does not
  // follow `new Worker(new URL(…))`, so a package only a worker imports was
  // found the first time that worker ran — pre-bundled then, and the page
  // reloaded under the user. Every worker module is named *Worker.ts; the
  // scan starts from those too.
  optimizeDeps: {
    entries: ['index.html', '**/*Worker.ts'],
  },
  test: {
    environment: 'node',
    // Each plugin keeps its tests beside it.
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'plugins/*/tests/**/*.test.ts'],
    // Long enough for any test that is not slow by nature, short enough that a
    // hang is found quickly. The files whose tests build solids in the kernel
    // or fit real scans raise it for themselves.
    testTimeout: 20_000,
  },
})
