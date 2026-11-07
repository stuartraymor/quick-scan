// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * A real-scan fixture at the repository root, or in the directory named by
 * QUICKSCAN_FIXTURES (a CI cache or a maintainer's folder of licensed example
 * scans kept out of the repository). The scans are too large for the
 * repository (gitignored via /*.stl), so the acceptance tests against them run
 * only where the files exist — but never silently: a missing fixture announces
 * exactly what is not being tested and where the file has to go.
 */
export function fixture(name: string): { path: string; exists: boolean } {
  const cache = process.env.QUICKSCAN_FIXTURES
  const cached = cache ? join(cache, name) : null
  const local = fileURLToPath(new URL(`../${name}`, import.meta.url))
  const path = cached && existsSync(cached) ? cached : local
  const exists = existsSync(path)
  if (!exists) {
    console.warn(
      `\n⚠ Fixture "${name}" not found — its acceptance tests are SKIPPED.\n` +
        `  These are the real-scan measurements, the strongest tests in the suite.\n` +
        `  Place the file at ${path}${cached ? ` or ${cached}` : ' (or set QUICKSCAN_FIXTURES to a directory holding it)'} to run them.\n`,
    )
  }
  return { path, exists }
}
