# Quick Scan 1.1.86 — installed reconstruction increment

The root shape error was implicit evaluated-surface snapping, not just rendering. Manual creation inherited scan-fitting behavior from its point-snapping setting, and the viewport could swap to separately fitted CAD on completion. New manual features now explicitly use an unprojected control surface. The editor's evaluated shape and measurements remain independent of CAD completion. Existing files retain their geometry; the explicit Use control surface action is undoable. See architecture.md for responsibilities and remaining coupling.

## Native geometry and visuals

Fresh QUICKSURFACE Pro 8.0.128 aerosol save/CAD export: same four nonplanar corners, 289 unprojected limit samples, maximum distance 0.000001137587 mm and RMS 0.000000487046 mm. No planarity assumption or whole-interior scan projection is needed for this case.

The original user-created corner sets in the two applications differed. The controlled comparison uses the exact native corners. Quick Scan tests show Shaded, Zebra and measured Tolerance, explicit legacy conversion, Undo/Redo and file reopening. Native and Quick Scan camera/lighting/colors are not fully registered, so these screenshots do not establish exact visual parity. Native Offset mode at slider 100 still showed partial occlusion where the patch crosses the scan; keep this geometric fact separate from missing draw calls. Surface Only enables unobscured inspection.

The previous native curved-point-on STEP gives a remaining maximum gap 0.049709171 mm, RMS 0.008062473 mm across 1121 control-surface samples. This remains a geometry gap; no color changes conceal it.

## Production interaction measurements

Same saved 124-quad machine part and scripted D-handle gesture, Chromium production bundle, 1500×950 viewport. Timings are pointer-event-to-next-animation-frame, not hardware display-latency measurements.

| Measurement | Result |
|---|---:|
| Legacy fitted surface, first held move | 50.6 ms (prior recorded 318.7 ms) |
| Legacy held moves, median / p95 | 16.0 / 28.9 ms, 33 moves |
| Legacy 124→125 release, first frame | 184 ms |
| Legacy stable completed CAD/analysis | 6290 ms |
| Explicit control surface, release first frame | 40.1 ms |
| Control-surface stable completed CAD | 4530 ms |
| Packaged / installed small D settle | 52 / 48 ms |

Stable-completion timings include a 600 ms unchanged-result verification interval. They are separate from first-frame measurements. Held edits do not wait for CAD. These results do not meet the one-frame target consistently and do not establish native timing parity. Synchronous cold-cache measurements and whole-feature CAD conversion remain limitations.

## Workflow and regression evidence

- Fourth-corner test: six changing measured candidates, no CAD/history until placement, one new feature with fitToScan:false.
- Native curved point and edge-chain joins: all four cases, exact connectivity, maximum pole error 0.000000814 mm; changing measured display survives held/release frames, Undo/Redo and reopening.
- Native hole-ring snap: maximum pole error 0.000000061 mm; hole retained, no nonmanifold edges. Three-sided split/closure: 0.000000040 mm maximum pole error. Saved large irregular repair: 107→162 quads, exact oriented connectivity, maximum pole difference 0.000002146 mm.
- Twelve native planar tolerance cases verify physical distances, signs, thresholds and Pass/Fail. The manual editor scenario covers creation, repeated chain duplication, selection filters, creases, manipulation, visibility, undo/redo, UI sizing and saved settings. Smoothing and broader topology operations are covered by the source suite, not fresh exhaustive native comparisons.
- Initial broad suite: 4418 passed, 42 existing fixture skips, two failures. The MCP version stamp was refreshed; an unrelated shell-diagnosis wall-clock budget failure under parallel load passed bounded rerun. Both affected files then passed all 27 tests. Final focused surface/measurement/STEP suite: 116 passed. Desktop: 48 passed. MCP: 127 passed on sequential rerun; initial parallel timeout logs are retained.
- Fresh nonplanar control-quad STEP test verifies a valid B-spline sheet, successful export/reimport and maximum distance below 0.00001 mm to evaluated surface samples. Existing sheet and solid STEP round-trip tests also passed.
- Release builder passed TypeScript, production build, plugin boundary, display-unit check and native packaged smoke. Packaged and installed D, release snap, Undo/Redo and fresh-process reopening passed. Installed EXE and ASAR hashes match the immutable release manifest.

## Preservation and delivery

The original aerosol project and native QSF were saved before replacement; No unsaved changes was verified before closing the installed application. The latest 124-quad checkpoint was separately preserved. In the new installation, the large project reopened with five surfaces, 124 faces on Freeform 4, inches and unchanged Min−0.0440 / Max+0.0389 / RMS0.0048 in. The final aerosol working copy preserves the original corner coordinates and topology with explicit control-surface mode; the original file remains untouched.

Source has no Git metadata. Scoped pre-change backups, changed source hashes and unified patch accompany this cycle. The publication checkout is separate. This is the fourth passing installed cycle since public 1.1.81 (82, 83, 85, 86; rejected 84 excluded), so publication is due. Passing the record gate does not establish complete parity.

## Remaining work

Curved multi-patch evaluator/CAD agreement; consistently sub-frame motion and quad commits; per-patch asynchronous CAD conversion; bounded/preemptible measurement warm-up; fully registered native visual comparisons; arbitrary/ray point and edge joining; exhaustive complex repairs; occasional cold editor entry; planned symmetry controls. Do not describe the environment as fully reconstructed or fully equivalent yet.
