# QUICKSURFACE → Quick Scan feature audit

Date: 1 November 2026 · Quick Scan v0.0.8 · Reference: QUICKSURFACE 8 bundled manual ("QUICKSURFACE Commands" pp. 6–14 and its table of contents) plus screenshots of QUICKSURFACE Pro 8.0.127.

> **Updated for v0.0.14:** since this audit, Phase 1 is done (Trim, Delete Faces, Helix placed; Import CAD as bodies; Hide Selected / Isolate / Show Hidden; Snapshot to clipboard; Help tab; mouse-help status line) and Phase 2 has started (Extract primitives dialog with quick tools; Create Sketch live cut outline, Pick, Create & Stay, Stacked sections). Rows below still show the v0.0.8 status — see CHANGELOG.md for what changed.

QUICKSURFACE behaviour is summarised in our own words from the manual; nothing here is verified by running QUICKSURFACE modelling (still activation-locked). Quick Scan status was checked by searching the source (`C:/Users/stuar/Programs/ScanRuler`); items marked *(to verify)* were not confirmed in code.

**Status key** — **Same**: works the same way, in the same place. **Placed wrong**: the capability exists in Quick Scan but is not where QUICKSURFACE puts it, or is shown disabled. **Partial**: exists but the workflow or options differ. **Missing**: not built.

## Summary

| Status | Count | What it means for the user |
|---|---|---|
| Same | 14 | Familiar already |
| Placed wrong | 10 | Quick wins: the engine exists, only the button/menu/dialog is wrong |
| Partial | 24 | Works, but the sequence or dialog differs from QUICKSURFACE |
| Missing | 33 | Needs new implementation |

The biggest differences a QUICKSURFACE user will feel, in order: (1) the **Extract primitives** select-then-pick-type flow; (2) **Align Interactive** with an on-model manipulator; (3) **multiple meshes** in one project (import scan adds rather than replaces, compare to other meshes, global fine align, merge/re-polygonise); (4) the full **Create Sketch** dialog incl. stacked sections; (5) **Free Form** SubD quad surfacing; (6) CAD commands that exist in Quick Scan's CAD panel but not on the Main ribbon.

## File menu

| Command | QUICKSURFACE behaviour | Quick Scan today | Status |
|---|---|---|---|
| New | Empty project | Quick Scan menu → New project | Same |
| Open | STL, OBJ, PLY, PTX, E57, QSF project | STL, PLY, OBJ, 3MF, STEP, `.scanruler` project | Partial — no PTX/E57 |
| Import Scan Data | Adds a mesh to the scene, keeping what is there | Replaces the scan (one scan per project) | Partial — needs multi-mesh |
| Import CAD | STEP/IGES as a CAD body | Menu entry opens a STEP **as a scan mesh**; the CAD plugin has a separate STEP-body import | Placed wrong — route to the CAD import; IGES missing |
| Save / Save as | Save project / save under a new name | Both download a project (desktop asks where each time) | Partial |
| Export | CAD model as STEP, IGES or STL | STEP (bodies + fitted elements) | Partial — IGES, CAD-to-STL *(to verify)* |
| Export to SOLIDWORKS / Inventor | Transfers the feature tree | — | Missing (out of scope without those products) |
| Export Visible Scans | Writes visible scans to disk | Export scan data (STL mm/in, 3MF) | Same |
| Exit | Quit | Window close | Same |

## Edit menu

| Command | QUICKSURFACE behaviour | Quick Scan today | Status |
|---|---|---|---|
| Undo / Redo | One step, not for every operation | Multi-step history | Same (better) |
| View | Standard views menu | View bar + axis gizmo | Partial — no view cube with hover controls |
| Align by Coordinate System | Primary/secondary/tertiary from planes, cones, cylinders, spheres, lines, points; Flip each; translate; apply to CAD/all features | Datum alignment with preview + Apply; tertiary is point-based; no per-feature Flip/Translate Pick/apply-to-CAD options | Partial |
| Align Interactive | Move the scan by a manipulator or typed steps; drag strength, mirrored-mesh preview, "As current view" | Opens the move/rotate-by-numbers editor | Partial — gizmo missing |
| By N Points | Pick matching points on scan and on another scan or CAD | Point pairs against a loaded reference mesh | Partial — scan-to-scan needs multi-mesh |
| Fine-align reference mesh | Best-fit to the reference | Best fit (ICP) to the reference | Same |
| Global Fine Align | Mutual best fit of 2+ scans | — | Missing (multi-mesh) |
| Hide Selected / Show Hidden | Hide selected triangles / bring them back | — | Missing |
| Rebuild | Replay the whole history | CAD history rebuilds; "Build again" in feature menu | Partial |

## Reference Mesh menu (Scan Data)

| Command | QUICKSURFACE behaviour | Quick Scan today | Status |
|---|---|---|---|
| Edit | Delete areas, remove duplicates, fill holes, smooth, repair | Mesh tools: delete marked, remove islands, fill holes, smooth, flip, trim, offset, shell, boolean, cut | Same (more tools) |
| Reduce Polygons | Reduce triangles keeping accuracy | Reduce tool | Same |
| Scale | Uniform / non-uniform scale | — (Offset is not scale) | Missing |
| Flip Mesh Normals | Flip triangle orientation | Flip tool | Same |
| Re-polygonise | One mesh from overlapping meshes | — | Missing (multi-mesh) |
| Deselect All | Clear triangle selection | Deselect All | Same |
| Set default colour / Auto colorize | Colour per mesh | — | Missing (multi-mesh) |

## Construct menu

| Command | QUICKSURFACE behaviour | Quick Scan today | Status |
|---|---|---|---|
| Extract Primitives | One dialog: select area (8 tools, degrees slider, select-connected, enlarge/shrink/isolate/hide/show/deselect/invert), then click plane/cylinder/line/cone/sphere to fit; labels + quick toolbar options | Dropdown picks the type first, then the area is marked in the element editor; Magic Wand, brush, window, lasso, enlarge, shrink, invert exist | Partial — **highest-impact workflow difference** |
| Plane / Cylinder / Cone / Sphere (typed) | Construct by parameters (Plane dialog: Constructed / From another plane / Type In) | Plane by typed values, offset, three points, midplane; cylinder/cone/sphere only by fitting | Partial |
| Symmetry Plane | Optimised mirror plane | Symmetry plane | Same |
| Plane/Cylinder/Cone from selected CAD face | Primitive from a picked CAD face | CAD plugin can sketch on a body face; no primitive-from-face | Missing |
| Plane from current view / along path / through sketch line / from 2D sketch | Further plane constructors (photo) | — | Missing |
| Reference Line / Reference Point | Built from other primitives | Several line and point methods | Same |

## Cross sections / 2D Sketch

| Command | QUICKSURFACE behaviour | Quick Scan today | Status |
|---|---|---|---|
| 2D Sketch (Create Sketch dialog) | Extruded/Revolved; OXY/OYZ/OXZ or Pick; Offset; Define interactive (arrow drag, live contour); snap; ignore scan; flip; through selection only; stacked sections; outline mesh; hide scan; Create & Stay | v0.0.8 stage: plane tiles, offset, draggable arrow, Create/Cancel | Partial — live contour and most options missing |
| Multiple sections | Many sections by direction or along a guide curve | Single sections; stacked not built | Missing |
| Sketch fitting (lines/arcs/circles, Auto Sketch, splines) | Fit primitives to section points | Fit all chains, infer corners, splines fitted to slice | Same *(to verify each)* |
| Corner trim, Auto fillet, Trim, Constraints, Dimensions | Sketch editing | Fillet/chamfer, relations, dimensions, trimming tools in the sketch editor | Partial *(to verify trim/corner-trim parity)* |
| Offset / Mirror / Linear-Circular-Grid copy in sketch | Sketch operations | Sketch pattern exists | Partial |
| Mesh Outline | Outline of the mesh as a sketch | "Shadow" sections read the outline | Partial |
| Export sketches (DXF) | DXF export of sketches | DXF export exists for 2D Measure sheets | Partial *(CAD sketches to verify)* |

## Surfacing

| Command | QUICKSURFACE behaviour | Quick Scan today | Status |
|---|---|---|---|
| Fit Surface | Best-fit surface to selected mesh | Fit surface | Same |
| 3D Sketch | Draw 3D splines on the scan | Patch-network curves drawn on the scan (not a standalone 3D sketch) | Partial |
| Helix | Guide helix for threads | Thread feature | Placed wrong |
| Loft / Sweep | Surfaces from curves | Loft, Sweep | Same |
| Pipe | Sweep a circle along a curve | — | Missing |
| Fill Surface / Blend Surface | Fill a boundary / blend between surfaces | Patch network fills cells | Partial / Missing |
| Sew Selected Surfaces | Knit touching surfaces into one | *(to verify — boolean/body tools)* | Missing |
| Extend Surface | Enlarge a CAD surface | — | Missing |

## Free Form

| Command | QUICKSURFACE behaviour | Quick Scan today | Status |
|---|---|---|---|
| New Free Form | Draw SubD quads on the scan, snap mode, crease, isolate | — (patch network is a different, NURBS-patch technique) | Missing |
| Wrap Surface | Cylinder wrapped on a selection → quads | — | Missing |
| Auto Surfacing | One-click quad wrap of organic meshes | — | Missing |
| Thicken Free Form / Convert to CAD body / Templates | — | Thicken exists for surface bodies | Missing / Partial |

## CAD

| Command | QUICKSURFACE behaviour | Quick Scan today | Status |
|---|---|---|---|
| Extrude (incl. draft angle) / Revolve | Features from sketches | Extrude, Revolve, Draft feature | Same |
| Circular / Linear / Grid pattern, Mirror | Body patterns | Pattern, Mirror | Same |
| Move Body | Move a body interactively | moveBody feature exists in the CAD plugin | Placed wrong |
| Thicken / Offset | Offset or thicken | Thicken, Offset body | Same |
| Trim | Mutual trim by picking pieces to remove | Trim feature exists; **Main ribbon shows it disabled** | Placed wrong |
| Fillet / Chamfer | Rounded/chamfered edges | Fillet, Chamfer | Same |
| Cut / Combine / Intersection of solids | Booleans | Boolean feature (Combine on CAD tab) | Placed wrong |
| Delete Faces | Click faces to delete | deleteFace feature exists | Placed wrong |
| Move face (photo) | — | Move face | Same |

## Analysis

| Command | QUICKSURFACE behaviour | Quick Scan today | Status |
|---|---|---|---|
| Compare | Colour map scan vs CAD | Surface Deviation | Same |
| Compare to other meshes | Colour map mesh vs other meshes | Deviation against a loaded reference mesh only | Partial (multi-mesh) |
| Measure | Distance between two picked scan points | 3D Measure between fitted elements | Partial |
| Surface Area / Volume (photo) | Readouts | Volume readout exists *(to verify placement)* | Placed wrong / Missing |
| Zebra Stripes / Environment Map / Draft / Straightness | CAD surface-quality views | — | Missing |
| Snapshot to clipboard | Copy the view image | — | Missing (small) |

## Settings / Help / screen

| Item | QUICKSURFACE behaviour | Quick Scan today | Status |
|---|---|---|---|
| Options (navigation, display) | Navigation scheme, colours | Settings dialog incl. mouse schemes; QUICKSURFACE MMB scheme is default | Same |
| Display Units (per project) | mm / m / in | Units dialog (global) *(to verify per-project)* | Partial |
| Language | A few languages | — | Missing |
| Help tab: video tutorials, Check for update, System log, Credits, About | — | Check for updates (in Quick Scan menu, auto-installs), Imprint | Partial — no Help tab |
| Quick-access toolbar, Q menu | Save, Save as, Undo, Redo above the tabs | Quick Scan menu + Undo/Redo in the top bar | Partial |
| Objects tree | ALL, Coordinate System, Meshes(n), Planes(n) with checkboxes; right-click menu | Grouped explorer with eyes; context menu *(to verify)* | Partial |
| History panel | Playback buttons, "< End of Model >" rollback marker | CAD playback and roll-back exist in the CAD panel | Placed wrong |
| Status line | Mouse-button help text | — | Missing (small) |
| Unsaved reminder | "Not saved for N minutes" toast | Automatic recovery checkpoints + "Unsaved changes" label | Partial |

## Ranked build plan

**Phase 1 — put existing engines where QUICKSURFACE has them (days, low risk):** Trim, Delete Faces, Cut/Combine/Intersect, Move Body, Helix/thread on the ribbon and menus; Import CAD → CAD body import; Volume/area readouts on Analysis; Snapshot to clipboard; Hide Selected / Show Hidden / Isolate; bottom status line with mouse help; Help tab (About, Credits, Check for update, Video tutorials link).

**Phase 2 — the daily workflows:** Extract primitives dialog (select first, then click the primitive type; quick toolbar; labels); Create Sketch dialog options incl. live section contour on the arrow, stacked sections, through-selection-only, outline mesh, Create & Stay; Align by Coordinate System dialog (Flip, Translate Pick, apply-to options); Align Interactive gizmo; typed Cylinder/Cone/Sphere; Measure point-to-point; mesh Scale.

**Phase 3 — multi-mesh projects:** Import Scan adds meshes; Meshes(n) in the tree; Compare to other meshes; N-points scan-to-scan; Global Fine Align; Merge/Re-polygonise; Auto colorize.

**Phase 4 — new geometry:** Free Form SubD (New, snap, crease, wrap, auto surfacing, thicken, convert to CAD), Pipe, Sew, Extend, Fill/Blend surfaces, Zebra/Environment/Draft/Straightness analysis, IGES, PTX/E57 import.

Each phase ships as its own versions with the usual evidence, and each item's acceptance criteria quote the manual section it implements.
