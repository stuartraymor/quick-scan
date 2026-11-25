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
| Instant Meshes (field-aligned quad layout) | BSD-3-Clause, © 2015 Wenzel Jakob, Daniele Panozzo, Marco Tarini, Olga Sorkine-Hornung | Ported to TypeScript in `plugins/reverse/core/freeform/instant/` for Auto Freeform; licence below and beside the port |

### Instant Meshes

Auto Freeform's quad layout is a TypeScript port of part of Instant Meshes
(<https://github.com/wjakob/instant-meshes>), used under its licence:

```
Copyright (c) 2015 Wenzel Jakob, Daniele Panozzo, Marco Tarini,
and Olga Sorkine-Hornung. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

You are under no obligation whatsoever to provide any bug fixes, patches, or
upgrades to the features, functionality or performance of the source code
("Enhancements") to anyone; however, if you choose to make your Enhancements
available either publicly, or directly to the authors of this software, without
imposing a separate written license agreement for such Enhancements, then you
hereby grant the following license: a non-exclusive, royalty-free perpetual
license to install, use, modify, prepare derivative works, incorporate into
other computer software, distribute, and sublicense such enhancements or
derivative works thereof, in binary and source code form.
```

No code or assets from any commercial scan-to-CAD product are included.
