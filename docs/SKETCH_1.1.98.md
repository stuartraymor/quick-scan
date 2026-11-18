# Quick Scan 1.1.98: 2D Sketch audit report (Batch 4)

This report covers the fourth batch of the 2D Sketch overhaul:
- a full audit of every sketch button;
- sketch tools for a connected assistant;
- stability on hostile input.

1.1.96 and 1.1.97 hold the first three batches.

**Reference:** the brief written from QUICKSURFACE's sketch tools. No fresh side-by-side run against QUICKSURFACE was made for this batch. The results are checked against the brief and against exact geometry, not a new native reading. Full QUICKSURFACE parity is **not** claimed. The open gaps are listed at the end.

## Audit: every sketch button, by real clicks

A new browser check (`e2e-sketch-audit`) drives the sketch editor with mouse and keys only. It reads the sketch after each step.

| Group | What was clicked | What was checked | Result |
| --- | --- | --- | --- |
| Draw | line, polyline, circle (centre), circle (3 points), arc, spline, rectangle, slot, polygon, tangent arc, middle line | the right pieces appear at the clicked sizes; Ctrl+Z / Ctrl+Y round-trip (polyline step by step) | pass |
| Interaction | Esc part-way through each tool, zoom while drawing, switching tools part-way | Esc leaves nothing pending and a second Esc returns to Select; nothing is left half-made | pass |
| Modify | drag, click / Ctrl+click select, Delete, Auto Join, Trim, Corner Trim, Dimension (and driving it), Mirror, Duplicate, Offset, Fillet, Chamfer, Project | each changes what it should and round-trips with Ctrl+Z / Ctrl+Y | pass after two fixes (below) |
| Relations | horizontal, vertical, parallel, perpendicular, collinear, equal, tangent, coincident, concentric, symmetric, plus Fix Position | each adds an equation to the solve and moves the geometry; Delete removes it and the count drops back; undo restores it | pass |
| Construction | toggle on the outline | the closed regions go from 1 to 0 and back | pass |
| Display | the dimension-label switch | labels follow the switch without changing the sketch | pass |

44 audit items, all passing.

**Defects found and fixed:**

| Defect | Before | After |
| --- | --- | --- |
| Ctrl+Z straight after Fillet / Chamfer | the radius field had the focus and kept the key, so nothing was undone | an untouched field passes Ctrl+Z / Ctrl+Y to the editor; the fillet is undone and redone |
| Esc on the Project prompt | the prompt stayed open | Esc cancels it |
| Default pattern spacing | rounded up to 1-2-5 steps, up to 3.3 × the selection (e.g. 200 mm for a 60 mm part) | about 1.2 × the selection on a finer 1 / 1.2 / 1.5 / 2 / 2.5 / 3 / 4 / 5 / 6 / 8 ladder |

Downstream use (constraints and dimensions → solid → saved project round trip) is covered by the existing full-sketch-workflow browser check. It still passes.

## Sketch tools for the assistant

Five new commands are available to a connected assistant through the same command layer as the panel. They need no network beyond the local connection.

| Command | What it does | Checked |
| --- | --- | --- |
| `reverse.sketch.mirror` | mirror pieces about a piece, a line through two points, or the sketch's U/V axis | exact copies; bad axes refused with a reason |
| `reverse.sketch.pattern` | linear (one or two directions), circular (about a point or a circle/arc), angular, along a curve | a grid far from the origin lands exactly; circular about a circle; along an arc |
| `reverse.sketch.spline` | add / remove a point, rebuild through N points, set or free an end direction | the shape change is reported; refusals for the wrong piece kind |
| `reverse.sketch.select` | pick pieces by id, kind, construction or position | with the sketch open, the panel shows the selection and the status bar says the assistant made it |
| `reverse.sketch.analyse` | per piece: length, true curvature (spline minimum radius), deviation from the scan within a tolerance with the stretches outside it; plus loose ends, closed regions and solve state | a square on a box's walls reads within 100 %; a line leaving the wall reads its stretch outside; arc curvature exact |

The assistant's changes are labelled **"Agent: …"** on the undo key and in the history, so they are told apart from the person's own steps.

A browser check (`e2e-agent-sketch`) connects a real assistant client to the running app on a scanned cylinder. It runs mirror, pattern, rebuild, analyse and select, then confirms what the person sees: the undo key's label, the selection count and status, and undoing the assistant's step.

## Stability

- A piece whose position is not a number (a damaged file) is now refused by name in every sketch tool that copies or edits geometry: Duplicate, Mirror, Offset, Trim, Fillet, Chamfer, Corner Trim, Pattern (including a guide curve) and spline edits. Before, the NaN could be copied into new pieces.
- Curve evaluation and the curvature comb return nothing for a spline with bad knots, instead of throwing.
- A new hostile-input test runs every tool against twelve cases:
  - an empty sketch, a stale id, a zero-length line;
  - identical, parallel and near-tangent lines;
  - a radius of 1e-9, coordinates at 1e7, micron-scale geometry;
  - doubled spline points, a zero-sweep arc, and NaN or Infinity.

  Each tool either refuses with a reason or returns only finite geometry. None throws, and the input is never changed.

## Checks

- Unit tests: 26 new (11 for the agent sketch tools, 13 hostile-input stability tests, plus default pattern spacing and comb corner breaks / bad knots). The full suite passed: 4598 tests.
- The full CI browser suite passes locally: 862 checks in 47 scripts. Two checks are new: the click-by-click sketch audit (44 items) and the agent sketch tools through a real MCP client. The GitHub CI run on the release commit must pass before the release is published.
- Installed 1.1.98, driven through its own interface only, on a saved test project:
  - The Batch 1–2 check still passes: 300° reflex angle, tolerance 24.8 % → 75.2 %, mirror, undo.
  - The Batch 3 check still passes: spline menus, Rebuild through 7, comb label, Pattern Accept and one-step undo.
  - Batch 4 check:
    - Polyline corner (8 → 10 pieces); both lines selected; Fillet (11) with the focus in the radius field; Ctrl+Z → 10; Ctrl+Y → 11.
    - Project prompt opens; Esc closes it.
    - The default pattern spacing for the drawn line was recorded (30 mm); Esc on the panel leaves the sketch as it was.
    - Pass, no page errors.

## Open gaps

- No fresh side-by-side comparison with QUICKSURFACE for this batch.
- Coincident and Concentric are reached from "Sketch settings and additional tools", not the ribbon.
- Shift+click also adds to a selection (as Ctrl+click does).
- The assistant's history undo is refused while the sketch editor is open; it works once the sketch is finished (Ctrl+Z in the editor works at any time).
- A pattern is a one-time copy, not an editable feature kept in history.
- The spline right-click menu has no Constraints or Dimensions entries yet.
- Control-pole splines must be rebuilt through fit points before adding or removing points or setting end tangents.
- Fillet radius handles and fillets between arcs or curves remain open from 1.1.96.
- The assistant tools were verified in the development build and headless; the installed app's check drives the interface only.
