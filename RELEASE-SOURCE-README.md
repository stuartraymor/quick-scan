# Quick Scan 0.0.120 corresponding source

The versioned release branch contains the Electron application, reverse-engineering plugin, worker, automation catalog and original icon resources used to package the Windows installer. The commit tagged for this version identifies the corresponding source.

Use Node.js 22 or newer. Install dependencies with `npm ci` and `npm --prefix mcp ci`. Run `npm test` and `npm run build`, then `node package-desktop.mjs` to package the Electron desktop. On Windows the Inno Setup script at `installer/build-installer.ps1` accepts the packaged application directory and an installer output directory. The desktop includes the file, update, example-library and agent bridges.

Three Quick Scan example meshes ship with the app. Help also lists ten reference part names. Set the local example directory under the Quick Scan icon, Settings, to resolve them on each machine.

`SOURCE-HASHES.json` records SHA-256 for each other tracked file using its normalized Git bytes. The release includes the Windows installer's separate SHA-256. See `RELEASE-VERIFICATION.md` for tested workflows and open differences. Upstream attribution and the AGPL-3.0-only license are retained.
