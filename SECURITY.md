# Security policy

## Supported versions

Quick Scan is in early development (0.0.x). Only the latest release receives
fixes.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Use GitHub's private reporting: open the repository's **Security** tab and
choose **Report a vulnerability**. Include the version, what you did, what
happened, and a sample file if one is needed to reproduce it.

You can expect an acknowledgement within about a week. This is a small
volunteer project, so fix times vary, but confirmed issues are fixed in the
next release and credited if you wish.

## Scope

In scope: the desktop app and installer in this repository, including file
parsers (STL, OBJ, PLY, 3MF, STEP, `.scanruler` projects), the `scanruler://`
app protocol, the Electron sandbox configuration and the optional agent bridge.

Out of scope: vulnerabilities in third-party software that are not caused by
how this project uses it (report those upstream), and the "unrecognised
publisher" SmartScreen warning on unsigned installers.

## Good to know

- The app runs sandboxed with context isolation and without Node integration.
- It processes files locally and makes no network requests of its own for your
  scan data. The agent bridge only talks to an assistant you connect yourself.
- Verify installer downloads against the SHA-256 printed in the release notes.
