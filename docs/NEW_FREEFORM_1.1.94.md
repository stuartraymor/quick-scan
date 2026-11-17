# Quick Scan 1.1.94: New Freeform comparison report

This report covers the development cycles since public 1.1.87: 1.1.88, 1.1.90, 1.1.91, 1.1.92, 1.1.93 and 1.1.94. 1.1.89 was built but never installed; its changes were carried into 1.1.90.

**Reference:** QUICKSURFACE Pro 8.0.128 on the same PC.

**Method:**
- Each behaviour below was reproduced with real press-and-hold mouse drags in QUICKSURFACE.
- The result was saved, and its control cage (poles and faces) was decoded.
- The same gesture was replayed in Quick Scan, and the cages were compared point by point.

**Display:** 2560 × 1440 at 100 % scaling.

Full QUICKSURFACE parity is **not** claimed. The open gaps are listed at the end.

## Joining quads

| Behaviour | QUICKSURFACE (measured) | Quick Scan 1.1.87 | Quick Scan 1.1.94 |
| --- | --- | --- | --- |
| Join reach for a dragged boundary point | about 11 screen px at any zoom (measured at 26 and 38 px/mm) | 5 px | 11 px |
| Join indicator | dark ring (~17 px) round the target while held | none | ring (18 px) round the target |
| Side dragged onto a side | welds one end only; each other seam point welds when dropped on its partner | dropped under 2 px from the grab point → treated as a click, discarded | same as native; drops of any length weld |
| Control Net off point weld | dropped point keeps its surface position | 0.97 mm off | poles match native to 1.2e-7 mm |
| D-handle pull onto another boundary | new corners weld one by one; seam corrected | never welded | identical faces; poles within 0.004 mm |
| Separate quad joined to a 4 × 3 grid's side | no other pole moves | — | no other pole moves (Control Net on and off) |
| Merge Freeform objects | — | not available | Object Tree → Merge, with Undo/Redo and saving |

## Editing

| Behaviour | QUICKSURFACE (measured on a 5 × 5 grid, inner point dragged 1.196 mm) | Quick Scan 1.1.87 | Quick Scan 1.1.94 |
| --- | --- | --- | --- |
| Control Net on | only the dragged pole moves | poles within 10 % of the model radius moved, with falloff | only the dragged pole moves |
| Control Net off, *Don't move neighbours* off | only the pole moves; its surface point follows (2.611 mm) | falloff over nearby poles | matches within 2e-8 mm |
| Control Net off, *Don't move neighbours* on | pole plus its 8 ring poles corrected (−0.547 mm edges, +0.025 mm diagonals) | corrections over the whole cage (16 poles, 0.085 to 0.29 mm off) | ring only; matches within 5.3e-7 mm |
| Close 4-sided hole | enabled for 4 selected edges; closes concave holes | convex holes only; refused a hole touching another boundary at one point | 4 edges or 4 corner points; concave holes and one-point contacts close; crossed, folded and collapsed results refused |
| Double-click line selection | stops at about a 31° turn | stopped at 25° | follows bends up to 45° (more forgiving than native, by request); stops at sharp corners such as the 79° corner of the native sphere cage |

## Speed

**Before:** on a 111-face cage, finishing a quad drew it in about 65 ms, then started a full CAD rebuild. That rebuild took 2.3 s for the first edit and 1.1 to 1.3 s after that.

**Now:**
- The CAD body is rebuilt when editing pauses (2.5 s), when the editor closes, or before an export.
- Unchanged block faces are reused (6 to 9 of 10 to 13 per edit on that cage).
- Each face's area is measured once.
- The kernel is warmed up when the editor opens.

## Application and updates

- Closing with unsaved work asks *Close without saving* / *Keep working* (the close was silently ignored before).
- *Restart to update* starts the installer only after Quick Scan has really quit. *Keep working* cancels the install and leaves the update ready. Before, the installer closed Quick Scan by force.
- Preferences carry over from the newest older version on an update's first launch.

## Verification

Every cycle above passed all of the following before publication:
- the full automated suite;
- TypeScript, the production build, the plugin-boundary and display-unit checks;
- a packaged desktop smoke test (save, reopen, CAD);
- packaged workflow harnesses for hole closing and native-paired joins, with Undo/Redo and reopening;
- a silent install with installed EXE/ASAR hashes checked against the package;
- reopening a large real-world 111-face Freeform project, unchanged.

## Known gaps

- The rectangle tool never welds its corners to existing poles (Add Face does, within 9 px). The native rule there has not been measured.
- Two points closer than 0.5 px on screen: the pick takes the lower index.
- Native Control Net on also draws smooth surface lines over the straight cage; Quick Scan draws the cage only.
- Interaction is not consistently one frame on large cages, and the final CAD build still takes seconds.
- Full visual parity with QUICKSURFACE is not claimed.
