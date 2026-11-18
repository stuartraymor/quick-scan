# Quick Scan 1.1.97: 2D Sketch comparison report (Batch 3)

This report covers the third batch of the 2D Sketch overhaul: the Duplicate/Pattern panel, the curvature comb and spline editing. 1.1.96 holds the first two batches.

**Reference:** the brief written from QUICKSURFACE's sketch tools. No fresh side-by-side run against QUICKSURFACE was made for this batch, so these results are checked against the brief and against exact geometry, not a new native reading. Full QUICKSURFACE parity is **not** claimed. The open gaps are listed at the end.

## Duplicate / Pattern

| Behaviour | Quick Scan 1.1.96 | Quick Scan 1.1.97 |
| --- | --- | --- |
| Entry | Duplicate by X/Y offset only | Duplicate → **Pattern…** opens a context panel (the X/Y offset stays) |
| Linear | — | two directions, each along X, Y or a picked line, with instances, spacing and flip; arrows on the sheet set the spacing by drag; parallel directions refused |
| Circular | — | about the origin or a picked centre; instances, total angle, CCW/CW, keep orientation; a full 360° never puts a copy on the original |
| Angular | — | about the selection centre, the origin or a picked pivot, by a fixed step |
| Along curve | — | along a picked line, arc, circle or spline by true arc length; equal or fixed spacing, start/end offsets, reverse, follow the tangent or keep orientation; never doubles the seam of a closed curve |
| Preview and commit | — | copies drawn dashed live; Accept (Enter) adds them as one undo step and selects them; Cancel/Esc changes nothing |
| Units | — | spacing and offsets in mm or inches; switching units never moves geometry |
| Exactness | — | a grid far from the origin lands exactly; arc length inverted to 1e-9 on a spline |

## Curvature comb

| Behaviour | Quick Scan 1.1.96 | Quick Scan 1.1.97 |
| --- | --- | --- |
| Source | curvature from sampled polylines | true curvature of the line, arc, circle or spline |
| Spacing | by parameter | evenly by arc length; Density sets the count |
| Options | scale slider only | Scale, Density, Max length, Noise filter, Signed, Labels, Offset reference line |
| Shape | — | teeth normal to the curve; envelope breaks at corners; signed teeth cross at an inflection |
| Label | — | smallest radius labelled, "R 10.000 mm" / "R 0.3937 in" |
| Lines | — | no teeth |
| With tolerance Analysis | — | both on at once, option panels side by side |

## Spline

| Behaviour | Quick Scan 1.1.96 | Quick Scan 1.1.97 |
| --- | --- | --- |
| Finish | Enter / tool change | also a double-click, or right-click → Finish / Close and finish |
| Right-click while drawing | — | Finish, Close and finish, Remove last point, Restart drawing, each enabled only when it can act |
| Right-click on a spline | general menu | Modify, Add point here, Remove this point, Rebuild…, Fixed, Construction, Delete (only implemented items) |
| Add / remove point | — | added on the curve where clicked (shape kept); removal keeps 2 points open / 3 closed; relations on later points follow |
| Rebuild | — | through N points evenly by arc length, ends kept; the largest shape change is reported in the current units |
| End tangents | lost on the next solve unless a relation held them | handles at both ends: drag sets the direction (snaps upright within 4°, Alt free), double-click frees it; hand-set ends survive the solver; one undo step |

## Checks

- Unit tests: 17 new for patterns and exact curve evaluation, 7 for the comb, 8 for spline edits. The full suite passed (4590 tests).
- The full CI browser suite passes locally (835 checks), now including three new checks: pattern, curvature comb and spline editing. The GitHub CI run on the release commit is required before publishing.
- Installed 1.1.97, driven through its own interface only, on a saved test project:
  - The Batch 1–2 check still passes: 300° reflex angle, tolerance 24.8 % → 75.2 %, mirror 8 → 13 pieces, undo.
  - Batch 3 check:
    - Draws a 5-point spline by clicks; the right-click drawing menu has all four items enabled; Finish adds it.
    - Right-click on the spline lists the seven items; Rebuild through 7 reports its change in mm.
    - The comb labels one smallest radius.
    - Modify, then Duplicate → Pattern…, 3 instances → Accept (2): 9 → 11 pieces; Ctrl+Z goes back to 9.
    - Pass, no page errors.

## Open gaps

- No fresh side-by-side comparison with QUICKSURFACE for this batch.
- A pattern is a one-time copy, not an editable feature kept in history.
- The spline right-click menu has no Constraints or Dimensions entries yet.
- Control-pole splines must be rebuilt through fit points before adding or removing points or setting end tangents.
- The default linear spacing rounds up coarsely (a wide selection can start at 200 mm, off-screen); drag the arrow or type the spacing.
- Fillet radius handles, fillets between arcs or curves, and the panel's folded angle while a dimension is in hand remain open from 1.1.96.
