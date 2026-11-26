# Quick Scan 1.2.72 corresponding source

This checkout contains the Electron application, reverse-engineering plugin, geometry workers, automation interfaces, reference guides, licenses and original assets for Quick Scan 1.2.72.

Use Node.js 22 or later. Install dependencies with `npm ci` and `npm --prefix mcp ci`. Run `npm test`, `npm --prefix mcp test` and `npm run build`. On Windows, `node package-desktop.mjs` packages the desktop application. The installer script accepts the packaged application directory as `-AppDir` and a new installer output directory as `-OutDir`.

Run the deterministic finishing benchmark with `node scripts/finishing-stress/run.mjs <new-results-directory> 512 8`. The runner records each stock part, the 50 requests it exercised, timings, checks and a summary. Individual scan fixtures used for local commercial CAD comparisons are supplied separately by their owners where permitted.

The Git tag identifies the source revision. `SOURCE-HASHES.json` records SHA-256 hashes for the corresponding source files. The release assets include the Windows installer and checksums. [Verification and limits](RELEASE-VERIFICATION.md) · [Attribution](ATTRIBUTION.md)
