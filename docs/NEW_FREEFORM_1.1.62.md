# Quick Scan 1.1.62 â€” native refinement and contextual editing

Scope: manual New Freeform only. Installed behavioral reference: QUICKSURFACE Pro 8.0.128. Full reconstruction remains incomplete. Source, packaged and installed checks pass. Installed EXE and ASAR hashes match the release manifest; the original five-surface project is restored clean in inches with Freeform 4 and Tolerance selected.

## Changes in this cycle

1. Manual Smooth takes a 10% neighbour step. A selected interior pole at 0.060 mm becomes 0.054 mm, then 0.0486 mm. Native Control Net and Don't move neighbours were both on for the first operation and off for the second; no unselected pole moved. With no selection, Smooth applies to the whole cage. In the controlled six-quad fixture it changes the two interior poles and holds boundary poles.
2. Empty-selection Snap to Mesh applies five simultaneous evaluated-limit corrections to all poles. It remains selected-only when entities are selected. This matches the saved native whole-cage result, including a small negative neighbouring pole required to bring the evaluated sheet toward the scan.
3. Manual Split inserts midpoint poles and adjusts adjacent regular rows one third toward their continuation away from the cut. A boundary-adjacent cut and a subsequent cut between two interior rows match native saved geometry. Shared API arbitrary-fraction splitting remains unchanged. Creased or extraordinary neighbourhoods retain conservative midpoint behavior; their native adjustment rule is not verified.

## Paired geometry and tolerance

All six browser cases compare actual saved native coordinates and oriented quad connectivity. Maximum pole difference for Smooth/snap is 3.24e-8 mm; the two Split cases are 5.97e-8 and 7.95e-8 mm. Split grows six quads to nine, then twelve. Finished-CAD signed distance agrees with independent plane-distance calculations within 1.20e-9 mm. Undo/Redo restores exact poles and measured values; project save/reload passes.

Registered Split Gradient comparisons cover 34,776 and 32,844 pixels, excluding boundary/control lines. Median maximum-channel errors are 2 and 3 RGB levels; 95th-percentile errors are 27 and 48. Color transitions are therefore not exact, despite matching control topology and poles. These are selected-image comparisons, not full visual equivalence or continuous-surface error guarantees.

The packaged Windows application passes selected Smooth, Q, empty contextual Smooth and Snap, both Split scenarios, Undo/Redo, native saved-coordinate/connectivity comparison and reopening. Saving is tested after closing Edit Surface, as in the native reference trials. The first packaged harness attempted the main Save button through the active modal overlay; it was blocked. Closing the editor and rerunning passes. Save while the editor remains open is not claimed.

## Prior passing cycles included in this publication group

- 1.1.59: selected Snap to Mesh uses five evaluated-limit corrections independent of Control Net and neighbour settings; native point/chain pole errors below 6e-11 mm. Paired deformation Gradient median 2â€“3 RGB; Pass/Fail agreement 98.4% for a point and 100% for a chain on comparable pixels. Increase Resolution has exact mapped connectivity.
- 1.1.60: native-observed isolated three/four-face irregular boundary repairs, warning button, atomic unsupported refusal, Undo/Redo and persistence. Saved native repair poles agree within 1.50e-7 mm.
- 1.1.61: whole Boundary perimeters, additive right-click, empty five-tool toolbar, and native single-chain Bridge refusal dialog. Valid open-chain bridges retain exact native connectivity. Native closed-loop experiments produced zero-area or disconnected faces, which Quick Scan deliberately rejects.

## Validation and limitations

Final source suite: 4,316 tests pass across 514 files, with 42 fixture skips in 15 files (415.27 seconds). Desktop 48 and MCP 127 pass. Browser, six packaged cases, production build, plugin boundary, unit checks, CAD smoke, installer and installed identity pass. An earlier full suite started before the Split correction loaded the previous editor module with the newly added reference tests and failed those two assertions; that log is retained. The final suite is started after freezing the runtime source. No source edits follow the final validation start.

Complete drag-to-Merge remains unresolved: observed native contact welds one pair and can relocate a neighbouring shared pole. A generic weld would not reproduce it. Symmetry, several context-enabling states, creased/irregular Split, missing-reference and Ray Projection policy, the full camera/visibility matrix and parts of the twelve paired tolerance experiments remain open. Auto Freeform is outside this assignment and was not changed.

Original native project restored from its preserved copy; reference/original-restored.jpg records it. Scoped backups, source patch, own calibration fixture records and screenshots are retained locally. Source/assets were independently authored; proprietary source and graphical assets were not extracted.
