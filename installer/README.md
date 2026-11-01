# Quick Scan installer

Inno Setup 6 script that wraps the packaged Electron app in a setup wizard:
branded images, notice page, AGPL licence page, install-location choice
(per-user by default, all-users on request), Start Menu shortcuts including a
source-code link, optional desktop shortcut, optional `.scanruler` file
association, uninstaller, and version/publisher metadata.

## Build

Needs [Inno Setup 6](https://jrsoftware.org/isinfo.php) (`winget install JRSoftware.InnoSetup`).

```powershell
node package-desktop.mjs
installer\build-installer.ps1 -AppDir "desktop-build\Quick Scan-win32-x64" -OutDir out
```

The script reads the version from `package.json`, refuses to overwrite an
existing installer, and writes `Quick-Scan-Setup-<version>.exe` plus a
`.sha256` file.

## Code signing

Unsigned installers trigger Windows SmartScreen ("Windows protected your PC").
Signing requires a code-signing certificate that you must buy or obtain; this
repository does not contain one. To sign, set in the environment (never commit):

```powershell
$env:QS_SIGN_PFX = 'C:\path\to\certificate.pfx'
$env:QS_SIGN_PFX_PASS = '...'
# optional: QS_SIGN_TIMESTAMP, QS_SIGNTOOL
```

and run the build script again. Both the installer and the uninstaller are
signed. Even a signed installer from a new publisher may show SmartScreen
warnings until reputation builds; an EV certificate avoids that sooner.
Until then, publish the SHA-256 with each release (the build script prints it)
and tell users to verify it.

## Notes

- Never change `AppId` in `quick-scan.iss`; it identifies the product for upgrades.
- Uninstalling keeps user data in `%APPDATA%\QuickScan-v*` on purpose.
- Publisher is shown as "Quick Scan contributors"; edit `#define Publisher` to change it.
