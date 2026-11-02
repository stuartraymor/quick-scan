# Quick Scan 0.0.39 verification

The final 0.0.39 installer was built, installed and exercised on Windows. This checkpoint improves Objects/History and the navigation corner while retaining Quick Scan's dark blue and white theme. It does not establish complete QUICKSURFACE parity.

## Automated validation

- Full suite: **3,221 passed, 24 skipped**; **387 test files passed, 13 skipped**. Skips are not passes.
- Production build, TypeScript, plugin-boundary check and MCP validation passed.
- Final browser acceptance: **260 checks passed**, using actual Basic Part and Machine Part models: Objects 26 + 26; History 37 + 37; core explorer 22; sketch access 15; deletion guards 13; navigation corner 42 + 42.
- History acceptance covers real interleaved scan/core/CAD order, shared selection and visibility, editing existing planes, dependency-safe sketch deletion, undo/redo, actual rollback/restoration, saved partial-history reopening, Parent/Child dependencies, and mouse dragging of End of Model. Partial-history mutation guards and available view/Undo/Forward controls were exercised.
- Packaged desktop smoke passed, including screenshot capture, with no captured application errors. All ten packaged sample-model hashes matched their source files.

## Installed Windows acceptance

Installed version **0.0.39** passed saved-boundary Back/Forward, Undo/Redo, ALL visibility with the independent Coordinate System preserved, and synchronized Objects/History visibility. Editing existing Sketch 1 reopened its four actual curves; Cancel returned to one sketch and one solid.

Native Parent/Child mode, dependency nesting, Collapse and Expand passed. Native Home/End restored the real core and CAD model. Browser mouse dragging passed; native automated drag attempts did not move the boundary and are inconclusive, so native mouse dragging is not certified.

## Artifacts

- Installer: `Quick-Scan-Setup-0.0.39.exe`.
- Installer SHA-256: `4553a20ec0fc3cf7ddc66d1d9146e07063c9e54b9859495c35faebfa608fcdd0`.
- Installed `app.asar` SHA-256: `a9729e2e2e24e6ca92d190bb9edfbd14ef1212fe6c851bbf1eaaeea2d611bceb`.
- The installer remains unsigned under the established packaging process. Publication is a separate release step; this document does not claim a hosted release has been published.

## Remaining limitations

Partial model timelines are intentionally read-only. Restore End of Model before creating or editing geometry or importing CAD; branching from an earlier model step is not implemented. Back/Forward and marker dragging change real active core records and CAD build state rather than only hiding future geometry.

Older projects did not record common cross-workspace chronology. Their migrated order is approximate. Parent/Child displays each entry once under its earliest recorded valid dependency; additional direct references are retained in its tooltip, rather than duplicating geometry or fabricating dependencies.

Context menus, full application workflows, every keyboard shortcut, file format and setting, and exact graphical/pixel/DPI parity remain incomplete or uncertified. True quad/SubD freeform, automatic freeform surfacing and stacked sections are not implemented. Verified workflows are the scope of this checkpoint, not a claim that every button or operation matches the reference application.
