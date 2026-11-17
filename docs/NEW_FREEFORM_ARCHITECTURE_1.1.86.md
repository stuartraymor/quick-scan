# New Freeform architecture reconstruction — 1.1.86

## Verified root cause

The editor used the same `snap` intent for placing/dragging control points and projecting every evaluated subdivision vertex. New manual features omitted `fitToScan`, so the resolver enabled scan fitting. The CAD builder could additionally refit small scans. Editing therefore showed a projected approximation and later replaced it with a separately fitted/tessellated CAD surface. That coupled shape, color and completion timing.

Fresh native evidence: saved the currently open aerosol patch in QUICKSURFACE Pro 8.0.128, converted a disposable copy to CAD and exported STEP. The four corners are noncoplanar. At 289 samples, the unprojected Quick Scan subdivision surface differs from the independently exported native CAD by at most 0.000001137587 mm (RMS 0.000000487046 mm). Native original freeform was reopened after the export. This establishes the initial patch rule for this observed case, not universal surface parity.

## Responsibilities

1. Editable topology and corner positions are the persisted model and undo/redo unit. New manual patches explicitly store `fitToScan:false`. Gesture snapping still places corners and snaps edited points on release. Explicit Refit to tolerance opts into fitting. Existing files with undefined/true retain their previous behavior; Use control surface is an explicit, undoable conversion.
2. The evaluated control surface uses topology-keyed subdivision/limit plans. Changed controls update dependent vertices and neighbors. No scan projection occurs for a control surface. Its evaluated mesh remains the editor's displayed/measured surface even after CAD finishes.
3. Viewport geometry and GPU attributes persist for unchanged layouts. Only changed attribute intervals are uploaded. A layout/topology change replaces the appropriate buffers. Selection, boundaries and manipulation handles remain separate.
4. Signed deviation samples belong to actual visible geometry and the current scan reference. Numeric coordinate caches and unchanged cell snapshots reuse exact measurements. Dense charts are prepared asynchronously before a gesture; preparation never substitutes stale colors. If preparation is not ready, current samples are measured synchronously. This fallback still limits worst-case interaction speed.
5. CAD conversion remains asynchronous through the existing latest-pending-revision scheduler, independently of held pointer motion. Manual edits and history remain available while CAD is pending. Immutable-body face-area measurements are reused across tessellation chords; face coverage checks remain active.

## Acceptance and limits

- Exact native aerosol corners, nonplanar shape, three displays, explicit legacy conversion with Undo/Redo, and project round trip.
- Fourth-corner measured preview changes without CAD/history before placement.
- Existing manual workflow: repeated D/chain extension, selection filters, smoothing, creasing, hidden faces, undo/redo and reopening.
- Native saved curved point/edge-chain joining fixtures, irregular repair and planar tolerance comparisons.
- Measure first motion, subsequent animation-frame latency, first release paint and completed CAD separately. Production large-part timings must be recorded without calling missed frame targets instant.

The old fitted path remains compatible and slower. The reconstruction does not yet replace all CAD conversion/tessellation with per-patch jobs; stale in-flight CAD may finish before the newest pending job runs. Live deviation has a synchronous cold-cache fallback. Exact native curved color placement, arbitrary/ray joins, all irregular repairs and native timing parity require additional evidence.
