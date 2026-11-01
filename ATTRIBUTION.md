# Attribution

**Quick Scan** is a modified version of **ScanRuler**.

- Original work: ScanRuler, © Stefan Hermann (CNC Kitchen), <https://github.com/CNCKitchen/ScanRuler>
- License: GNU Affero General Public License v3.0 only (`AGPL-3.0-only`), see [LICENSE](LICENSE)
- Modifications: Quick Scan's product name, icon, ribbon-style command layout,
  object explorer and history panels, modeless tool panels, desktop (Electron)
  packaging and installer. The full history is in [CHANGELOG.md](CHANGELOG.md).
  Source files keep their original SPDX headers and notices.

Quick Scan is not endorsed by, sponsored by or affiliated with CNC Kitchen or
Stefan Hermann. "ScanRuler" and "CNC Kitchen" names and logos belong to their
owner and are not licensed by the AGPL.

## Network and distribution notice

Under AGPL-3.0 section 13, anyone who runs a modified version of this program
for users over a network must offer those users its corresponding source. The
desktop installer and every release of this repository ship with, or link to,
the complete source.

## Retained upstream materials

`COMMERCIAL.md` and `CLA.md` are the upstream author's documents about
commercial licensing and contributions to the *upstream* project. They are kept
unchanged so the provenance is clear. They do not grant anything on behalf of
the upstream author and do not bind contributors to this fork.

## Third-party components

| Component | License | Notes |
|---|---|---|
| Open CASCADE Technology (via `occt-wasm`) | LGPL-2.1 with OCCT exception | Loaded as a separate `.wasm` file; unmodified |
| meshStep | AGPL-3.0-only | By the ScanRuler author; STEP importer |
| Electron | MIT | Desktop shell; Chromium licenses in `LICENSES.chromium.html` |
| Three.js, React, Zustand, three-mesh-bvh, fflate, meshoptimizer, manifold-3d | MIT / permissive | See each package |
| Bundled fonts | SIL OFL 1.1 | License files in `public/fonts/` |
| viridisLite colour maps | MIT, © 2015 Simon Garnier | Notice in `src/core/field/colormapData.ts` |

No code or assets from any commercial scan-to-CAD product are included.
