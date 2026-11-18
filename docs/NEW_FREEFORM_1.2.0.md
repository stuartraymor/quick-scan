# Quick Scan 1.2.0: New Freeform refinement report

This report covers one batch of work on the New Freeform editor (Edit Surface): joining quads, the surface displays, editing behaviour and the finished CAD of a joined cage.

**Reference:** QUICKSURFACE Pro 8.0.128. Three behaviours were measured in it for this batch (below). The rest is checked against the editor's own geometry and earlier recorded QUICKSURFACE results. Full QUICKSURFACE parity is **not** claimed. The open gaps are listed at the end.

## Defects found and fixed

| Seen in the editor | Cause | After |
| --- | --- | --- |
| New quads attach to the wrong corner, leave duplicate points, or draw edges in the wrong place after a pause | Points and edges of a control surface were snapped onto its finished CAD body, which is built only after a pause and was several quads behind | A control surface is drawn and picked on its own evaluation |
| A point dropped on another does not join (sliver seams) | The join compared depths within a fixed band of 0.01 of the view's depth range, about 1 mm; a point dragged in the screen plane over a curved scan arrives at another depth | The band still passes; beyond it the depths may differ by twice the sideways distance the point was dragged |
| The first corner of a separate quad joins, the second never does | Quads drawn in opposite senses share the seam edge in the same direction, which was refused | The smaller part is turned to fit, in point and side joins, D-pull joins, Add face, Close 4-sided hole and Bridge |
| Orange quads; grey in Tolerance; no stripes in Zebra | A quad wound counter-clockwise as seen shows its reverse side; the rectangle tool wound two of its four drag directions that way | A new quad that shares no edge is wound to face the viewer |
| A transparent surface turns orange and loses its Zebra stripes | The first of the two transparent drawing passes reverses the front-face sense | The finish reads the pass's sense back |
| Finished CAD of a joined cage: patches not sewn, up to 0.38 mm off the edited surface | Round a T join or notch the surface is not bicubic; faces through 5 samples a quad edge stray from it | Such a cage is sampled at 4 refinements (up to 625 quads) and sewn at 0.01 then 0.05 mm |
| Undo past the first quad, then Redo: the surface returns as a finished body that cannot be edited | The editor let go of the feature when Undo removed it | The editor takes the feature up again when Redo restores it |
| A point dragged through its own quad joins a point beyond it, folding the quad over its neighbour | The fold check compared with the cage already dragged | Checked against the cage before the drag; two quads sharing three points are refused |
| A D pull dragged back over its own quad is accepted on a curved scan | The fold-back guard asked for exact coplanarity | Facing against the neighbour and within a tenth of its size of its plane is refused |
| A D pull shows the join ring while held and does not join on release | On release the new corners are snapped to the scan first, which can carry them out of the 11 px band | The joins shown while held are kept on release |
| Don't move neighbours with Snap Mode on: the surface round the dragged point moves 0.73 mm on a curved scan | The snap on release moved the picked control point alone | The snap is the goal of the same five-correction move (measured, below): 0.23 mm |
| The D handle is missing on some boundary edges at a low viewing angle | The edge midpoint was judged hidden by the flat-faceted drawing of its own quad | An edge's own quad cannot hide it |

## Measured in QUICKSURFACE for this batch

| Question | Set-up | QUICKSURFACE | Quick Scan 1.2.0 |
| --- | --- | --- | --- |
| Don't move neighbours with Snap Mode on (Closest Point, Control Net off) | A 5 × 5 sheet of 2.4 mm quads 0.5 mm above a flat scan; one inside point dragged; the saved cage read back | Nine control points change: the picked one by (1.199, 2.690, −1.244) mm, the four beside it by (−0.237, −0.480, +0.217), the four diagonal by (0.019, 0.014, −0.003). The picked surface point ends 0.043 mm above the scan | The same rule, 0.016 mm worst difference over the 36 control points. The earlier rule was 0.077 mm from it |
| Where a one-quad corner is drawn | Two separate 4 mm quads 2 mm apart | At its control point | The same |
| Rectangle tool begun on a corner of an existing quad | The same two quads | A separate quad, not joined | **Joins** a corner within 11 px of an open point. A deliberate difference, kept at the user's request |

## Checked in the running editor

| Area | What was done | Result |
| --- | --- | --- |
| Displays | Shaded, Tolerance and Zebra in Solid, Solid with edges and Transparent, with Control Net on and off and Surface Only on and off | No reverse-side colour in any of the 36 combinations; the legend shows only in Tolerance |
| Transparency | Slider at 10, 50, 90, 100 and back to 0; against each Surface View and both Mesh Display settings | Reads 0 in Solid and Solid with edges; moving it selects Transparent; Transparent returns at the value left; 0 returns to Solid with edges |
| Building and joining | D pulls, point joins, whole-side joins, rectangle, Add face, Close 4-sided hole from four edges and from four points, Bridge, delete and rebuild, in top and tilted views, in each display and with Control Net on and off | All join; cage sound at every step |
| Bad drags | A corner dropped on its own neighbour, dragged through its quad onto a far corner, Escape while dragging | Refused or cancelled; cage unchanged |
| Neighbours | Centre point of a 4 × 4 sheet dragged 3.6 mm in every combination of Snap Mode, Control Net and Don't move neighbours | Control Net on: one control point moves, box or no box. Control Net off, free: one control point, the surface round it follows (0.90 mm). Held: nine control points, the surface round it within 0.19 mm (0.23 mm with Snap Mode on) |
| Snapping | Snap Mode off and on, Closest Point and Ray Projection, Snap to Mesh on the whole surface | Snap to Mesh: surface points from 2.20 mm to 0.02 mm off the scan |
| Other tools | Align Horizontally and Vertically, Smooth (button and Q), Drag Strength, Extrapolate, Brush select, Brush smooth, Increase Resolution, Split, crease and remove crease, Refit to tolerance, Use control surface, irregular-points repair | Each does what it should; aligned points lie on one screen row or column exactly |
| Random editing | 60 seeded random actions (pulls, joins, moves, deletes, Add face, Split, Undo, Redo, display changes) | No console error, no non-manifold edge, mixed winding or coincident points at any step; the CAD body builds valid |
| Finished CAD | A 3 × 3 sheet with a quad joined on by one side; a notched 120-quad sheet | Four patches with three shared seams, under 0.02 mm from the edited surface; 120 quads built in under a second |

Automated checks: the unit suite (4,648 tests), the whole browser suite, and the packaged 1.2.0 build driven through its own interface with no development hooks (rectangle, D pull, two corner joins, every display at two transparencies, Undo to nothing and Redo).

## Known gaps

- A plain point drag can still fold a quad. Only joins and D pulls are refused. QUICKSURFACE's behaviour here was not measured.
- The fold guards are local. Random sideways D pulls can still lay a sliver over a quad that is not its neighbour; there is no whole-surface self-intersection test.
- With Don't move neighbours ticked the surrounding surface is held approximately (0.19 mm of a 3.6 mm drag on the test sheet) and the dragged point ends about a tenth short. This is QUICKSURFACE's own five-correction behaviour, kept on purpose.
- The measured snap rule fits QUICKSURFACE to 0.016 mm, not exactly. The remainder is unexplained.
- An L of three quads rounds its inside corner strongly and shows the irregular-points notice, as the subdivision surface does; the notice's repair fixes it.
- Tolerance colours stay opaque when Surface Transparency changes, as in QUICKSURFACE.
- The join's slope allowance, turning a part to fit, and facing a new quad to the viewer are this project's judgement, not QUICKSURFACE measurements.
