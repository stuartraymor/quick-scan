# Quick Scan 0.0.44 - Sketch workflow preview

Windows x64 installer with branded modern wizard, optional desktop shortcut and project-file association, upgrade handling and uninstall support. The installer is unsigned.

## Changes

- Corner Trim now opens a dedicated intersection/fillet workflow with real reference-point radius fitting, green preview, Shift-box selection, Apply and Undo.
- Project previews all other visible sketches and creates linked geometry in one operation. Unsupported projections report a blocker.
- Stacked sections collect real cuts into one persistent reference cloud, without automatic geometry fitting or multiple sketch commits. Clear, Ignore scan and Hide scan have distinct effects.
- Compare has a multicolor inspection-surface icon matching the default blue/cyan/green/yellow/red deviation map.
- Retains the circular fitting brush, graphical multiselection constraints, driving dimensions, original-position drag guides and AI setup from 0.0.43.

## Verified on Windows

- Full regression suite: 3,331 passed, zero failed, 24 skipped across 414 files (401 passing, 13 skipped).
- Complete actual-browser workflow: import mesh, circular brush fit, graphical Horizontal/Parallel constraints, driving diameter 20 mm, extrude 12 mm, save a real project archive, reopen and edit from History. Closed OCCT solid, volume 3,769.911184 mm3; topology and dimensions survive reopening. 13 checks passed, no console errors.
- Corner Trim/Project: 22 UI checks; stacked sections: 13; brush fitting: 18; sketch controls: 47. No unexpected console errors.
- TypeScript, production build, plugin-boundary check and packaged native import/save/reopen/OCCT smoke passed. Branded Windows installer completed successfully on this PC.

## Remaining differences

This is a focused preview release, not an exact QUICKSURFACE mirror. Full primitive rotation/resize parity, complete alignment reference picking, Objects-tree appearance/context actions, Plane/Cylinder editor matching and broader complete-part reconstruction remain unfinished. Sketch differences include radial stacks, selected-region stacked filtering, graphical stack extent handles, full Auto Join/Sketch Assist matching, IGES export and several analysis/display controls. Corner Trim currently handles one line-line corner per selection. Some tilted projected curves are unsupported. Exact proprietary fitting algorithms and every reference workflow have not been reproduced or verified.

Original upstream ScanRuler attribution and AGPL-3.0-only licensing are preserved. Corresponding source and SHA-256 checksums accompany this release.
