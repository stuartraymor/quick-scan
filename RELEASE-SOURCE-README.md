# Quick Scan 0.0.44 corresponding source

This source continues the verified v0.0.43 tag and the local 0.0.40–0.0.42 review increments. The release branch is based on that tag; the repository main branch contains older application source and was not overwritten.

Build with Node.js 22+: npm ci, npm run build, node package-desktop.mjs; use installer/build-installer.ps1 for a Windows installer. The desktop package must include agent-setup.cjs, preload.cjs and recents.cjs. The MCP integration test additionally needs npm --prefix mcp ci.

See docs/AI_SETUP.md and RELEASE-VERIFICATION.md for behavior, test coverage and remaining QuickSurface parity gaps. No exact-equivalence claim is made. Reference samples are separately excluded from this source archive; preserve the catalog/license boundaries when rebuilding a sample-enabled installer.

SOURCE-HASHES.json records SHA-256 of every other file in this normalized-LF corresponding source archive. Original upstream attribution and AGPL-3.0-only licensing are preserved.
