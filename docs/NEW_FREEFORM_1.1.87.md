# Quick Scan 1.1.87 — New Freeform follow-up

This cycle fixes visible surface-point release snapping, adds the viewport tolerance legend, and retains mesh visibility controls across editor sessions. It continues the architectural separation introduced in 1.1.86. Full QuickSurface parity is not claimed.

## Evidence

- Saved user aerosol: two shared surface anchors were 0.1384851 and 0.7648194 mm from the mesh while their poles were on it. A synthetic gesture independently reproduced a 0.6666667 mm post-release error. The new regression fails before the fix.
- Six actual point-drag trials on that saved project now release within 4e-15 mm of closest scan points in the development harness. This is numerical correspondence, not physical scan accuracy. Exact Undo restoration passes.
- Current native QUICKSURFACE Pro 8.0.128 uses a vertical +5T/+T/-T/-5T legend and supports transparent scan inspection. Quick Scan now shows that scale in the viewport, updates its units/thresholds, explains off-scale/reverse-side appearance, and retains mesh display settings when reopening Edit Surface. Small viewport and Shaded/Zebra/Tolerance switching pass.
- Four saved native curved point/chain join cases retain exact oriented connectivity, maximum pole difference 0.000000814 mm, Undo/Redo and reopening.
- Packaged D pull keeps measured preview, snaps on release, preserves source poles, supports Undo/Redo and fresh-process reopening. Release-to-stable-visible result: 44 ms on the small curved fixture; maximum new-pole scan gap 2.12e-16 mm. This is not a claim of one-frame response.
- Broad source run: 4,422 passes, 42 existing unavailable-fixture skips, one unrelated shell-diagnosis wall-clock-budget failure under concurrent build load. The bounded five-test shell rerun passes without changing code or weakening assertions. Desktop tests: 48 pass. MCP and installation records are tracked separately below.
- TypeScript, plugin boundary, display units, production package and packaged smoke pass. Scoped source backups and the unified patch are retained. File/protocol schemas and MCP command definitions are unchanged.

## Limits and remaining work

The large aerosol patch still extends several millimeters away from the scan between its corners. At tolerance 0.01 mm, much of it is outside the ±0.05 mm color scale; correct analysis is therefore dark there. No automatic whole-surface fitting or fabricated green values were introduced to conceal this.

Equivalent single-patch aerosol geometry in 1.1.86 agrees with native within 0.00000114 mm over 289 samples. The separate curved multi-patch comparison still has maximum 0.04971 mm disagreement. The current native aerosol cage was extended by the user and differs from the two-quad Quick Scan example; their current screenshots are not an equivalent-geometry color comparison.

Native non-contact curved deformation, arbitrary/ray joins, complex repairs and exact full visual parity remain open. Prior measured 124-quad performance: first movement 50.6 ms, median 16 ms, p95 28.9 ms; control-surface release first paint 40.1 ms and stable completed CAD 4,530 ms including a 600 ms stability gate. These are the previous cycle's measurements, not newly attributed to 1.1.87. Normal interaction is not consistently one frame, and final CAD still takes seconds.

Original user work is preserved as user-snapping-example.scanruler. Installing the fix does not silently reshape existing projects. Control Net OFF edits surface anchors; Control Net ON edits poles. STEP remains B-spline/NURBS CAD conversion, with the prior valid exported aerosol sheet retained.

## Installed verification

Installer exit 0; installed EXE and ASAR hashes match the packaged files. Installed D release was 48 ms with maximum new-pole gap 2.12e-16 mm, and Undo/Redo plus fresh reopening passed. All 127 MCP tests pass. The original two-quad aerosol reopened clean in the visible installed 1.1.87, with unchanged Min -0.832 / Max 3.999 / RMS 1.535 mm. Tolerance and the vertical scale are visible; mesh transparency is 41 percent. Original coordinates and project files were not rewritten. Twelve native planar tolerance cases and six changing measured fourth-corner previews pass.
