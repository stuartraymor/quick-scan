# Quick Scan 1.1.96: 2D Sketch comparison report

This report covers the first two batches of the 2D Sketch overhaul. They were built as 1.1.95, which was not published: GitHub CI found that the held Corner Trim stroke had been made slightly see-through. 1.1.96 restores the opaque stroke and is the first public build.

**Reference:** QUICKSURFACE Pro 8.0.128 on the same PC, for the features it has. Features QUICKSURFACE does not have (the brush ring and live preview, joins between arcs and curves, mirror about any line, live tolerance colours) are checked against Quick Scan's own requirements.

Full QUICKSURFACE parity is **not** claimed. The open gaps are listed at the end.

## Corner Trim

| Behaviour | QUICKSURFACE (observed) | Quick Scan 1.1.94 | Quick Scan 1.1.96 |
| --- | --- | --- | --- |
| Icon | its own | shared look with Trim | own icon: two sides joined by a rounded corner, in the theme accent |
| While the button is held | grey stroke painted; geometry unchanged until release | stroke only | stroke, a brush ring that follows the cursor, the ends it would take ringed, and the result previewed dashed |
| Fast sweeps | — | sampled points, could skip a piece | every stroke segment tested exactly; a 2-step sweep joins |
| Line + line | exact crossing, near or far end chosen | same | same (unchanged path) |
| Line + arc, arc + arc, line/arc + open curve, curve + curve | — | refused | joined at the exact crossing nearest the painted ends (Newton-refined, about 1e-13); far ends never move; curves keep their shape |
| Circles, closed curves | — | refused | refused (no ends) |
| Esc, empty stroke | nothing changes | nothing changes | nothing changes |

## Auto Fillet from the scan

| Corner angle | Result on a test plate (R 5 mm rounds) |
| --- | --- |
| 90° plate corner | R 5.004 mm from 47 section points, 0.0015 mm RMS; joins with no gaps (< 1e-7 mm) and tangent (1e-6) |
| 12°, 35°, 90°, 125°, 160°, 172° (synthetic) | radius and centre recovered; G0 and G1 kept; a radius dimension is added |
| Stray points | up to two passes drop points beyond 3 robust deviations, keeping at least 80 % |
| Non-circular blend | refused, with a message pointing to Fit Curve |

1.1.94 fitted only part of the corner and failed above about 120°.

## Construction geometry and Mirror

| Behaviour | Quick Scan 1.1.94 | Quick Scan 1.1.96 |
| --- | --- | --- |
| Construction pieces | drawn solid | dotted, 4 px dash and gap at any zoom; still selectable and dimensionable; never close regions |
| Mirror line | one construction line in the selection | click any line, construction line, the sketch X or Y axis, or a plane trace |
| Preview | none | the copies are drawn dashed while an axis is hovered; Accept (or Enter) adds them as one undo step; Esc cancels |
| Distance from the line | pieces had to touch it | any distance: a closed rectangle 40–60 mm away becomes a second region; originals unchanged |
| Exactness | — | (10, 5) about X = 0 gives (−10, 5) exactly; about y = x − 15, (25, −6) gives (9, 10) |

## Angle dimensions

| Behaviour | Quick Scan 1.1.94 | Quick Scan 1.1.96 |
| --- | --- | --- |
| Which angle | always the folded angle, 0–180° | the sector under the cursor: θ, 180 − θ, or at a corner the reflex 360 − θ |
| While placing | fixed | arc and number follow the cursor live |
| Driving | folded | a typed 290° or 100° is solved in its own sector |
| Old projects | — | dimensions without a sector keep the old behaviour |

## Live tolerance

| Behaviour | Quick Scan 1.1.94 | Quick Scan 1.1.96 |
| --- | --- | --- |
| Display → Analysis | not wired | colours each portion: green within ± tolerance, red outside, or a gradient |
| Options | disabled | tolerance in mm or inches; Pass/Fail or Gradient |
| Read-out | — | legend; min / max / mean / RMS; share of the length within tolerance; pieces outside |
| Updates | — | at once when the tolerance or the geometry changes |
| Check | — | a line climbing 0.4 mm off a plate edge over 20 mm passes along 24.8 % of its length at 0.1 mm, 75.2 % at 0.3 mm, 100 % once moved onto the edge |

## Checks

- Unit tests: 14 new for Corner Trim joins and Auto Fillet, 6 for Mirror, 7 for angle sectors, 10 for tolerance analysis. The full suite passed; two unrelated tests that timed out under load passed when rerun alone.
- The full CI browser suite (800 checks) passes locally, and the GitHub CI run on the release commit is required before publishing.
- Browser checks against the development build: corner brush, mesh fillet, dotted construction, mirror axis, angle sector, tolerance. All pass.
- Installed 1.1.96, driven through its own interface only: opens a saved test project, edits the sketch, reads the 300° reflex angle, Analysis 24.8 % then 75.2 % then gradient, box-selects 5 pieces, mirrors about the Y axis (8 → 13 pieces, 1 → 2 regions), and Ctrl+Z goes back to 8. Pass, no page errors.

## Open gaps

- Fillet radius drag handles and flip/alternative solutions are not done; the radius is edited through its dimension.
- Fillets between arcs or curves are not done (Corner Trim joins them).
- While an angle dimension is still in hand, the panel's number shows the folded value until it is put down.
- Duplicate/Pattern, curvature comb, spline handles and context menus are the next batch.
- The QUICKSURFACE cursor shape could not be captured, so it was not compared.
