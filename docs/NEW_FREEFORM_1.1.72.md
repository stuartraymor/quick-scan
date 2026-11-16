# New Freeform comparison update 1.1.67–1.1.72

Manual New Freeform continues to follow controlled observations of QUICKSURFACE Pro8.0.128. This update covers five passing local cycles;1.1.69 was superseded after an installed first-image defect and does not count as a passing cycle.

- 1.1.67: Reverse sides use orange in Shaded/Zebra and gray in Tolerance, following paired winding tests. Geometry and measured deviation survive display switching and reopening.
- 1.1.68: The warning action repairs multiple independent verified irregular boundary fans atomically. An unsupported later component leaves all geometry and history unchanged.
- 1.1.70: Tolerance stays measured during hover, selection, drag previews and CAD rebuilds. New finished data gets complete normal buffers; unchanged data reuses its GPU buffers. Brighter selected edges have a contrasting dark outline. The latest90-quad project has119670 valid initial normals and no missing tolerance surface across105 observed interaction frames.
- 1.1.71: Connected repair extends through regular boundary rows in the observed sequential order.77→94 and90→123 quads match native oriented connectivity and saved poles within1.908e-6mm. Browser and packaged repair, Undo/Redo and fresh-process reopening pass. Independent finished-CAD distance checks agree below1.331e-8mm.
- 1.1.72: Closest Point snapped surface-point dragging and Merge work with both neighbour settings. Eight native corner/midpoint half-drag/contact cases match oriented connectivity and browser poles within5.249e-7mm. Cancel and absent scan correspondence preserve the cage.

The native three-sided-gap workflow is verified through Split, complete Boundary selection and Close4-sided hole. Existing Quick Scan commands match the oriented connections and positions within3.974e-8mm; direct three-click triangular-face closure remains unverified. The holed-plane snap retains two loops, and47917 smooth CAD samples agree with analytic distances below1.908e-8mm, including samples over missing scan data. Its actual out-of-tolerance values remain visible.

Final source checks:4360 tests passed,42 existing fixture skips;48 desktop and127 MCP tests passed. Manual editor, TypeScript, production, plugin-boundary, units and packaged CAD smoke passed. MCP schemas and upstream attribution are preserved. No proprietary graphical assets were extracted.

Full equivalence remains incomplete. Open work includes arbitrary irregular fan repair, broader curved and Ray Projection drag correspondence, constrained/multiple-point merging, exact visual transitions, dense-drag performance and occasional cold CAD entry needing a second click. The comparisons do not certify universal production equivalence.
