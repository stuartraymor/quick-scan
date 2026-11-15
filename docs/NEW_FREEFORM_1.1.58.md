# New Freeform reconstruction: 1.1.58

Manual New Freeform remains an ongoing reconstruction against installed QUICKSURFACE Pro 8.0.128. This release does not claim complete equivalence. Existing upstream attribution and AGPL licensing are retained; reference source and graphics were not copied.

Since public 1.1.24, the editor gained evaluated-surface selection and manipulation, working shaded/Zebra/Tolerance displays, signed finished-CAD deviation measurements, mesh presentation, snapping/refitting, refinement and offset tools, and separate Convert to CAD output. Local cycles tested these incrementally.

The latest four correction cycles (1.1.55–58) cover:

- Transactional Deviation Options, accepted session settings, unit precision, invalid-measurement reporting, and the native gradient legend in Pass/Fail.
- Equal open boundary-chain bridging with saved native quad connectivity and modifier selection through overlapping handles.
- Tolerance normals from evaluated geometry and independently calibrated camera lighting. Eleven planar reference colors agree within one RGB level; held-out Top Pass/Fail agrees within four. Cylinder median channel errors improved, but an isometric 95th-percentile error of 41 remains.
- Complete interactive cage deletion, exact geometry/selection Undo, empty-feature persistence and recreation. Restoring cached CAD geometry now notifies the editor so Tolerance returns to finished-CAD samples instead of staying on preview samples.

Validation: 4,301 local source tests passed, with 42 unavailable-fixture skips; 48 desktop and 127 MCP checks passed. TypeScript, plugin boundaries, units, production build and packaged CAD smoke passed. Browser and packaged checks exercise context Delete, Undo/Redo, saved empty geometry, reopening and four-corner recreation. Twelve analytic signed-plane/tolerance combinations measured errors below 1e-7 mm in the preceding cycle. These sampling checks are not a bound on continuous maximum deviation.

Remaining gaps include complete drag-to-Merge behavior, all context enabling rules, quantified native Drag Strength falloff, symmetry, irregular-point repair, ray correspondence around holes, and the complete twelve-experiment paired tolerance campaign. Some controls are explicitly disabled. Accepted display options persist within a session, not in portable project settings. Native numerical readouts were not available for every color experiment.

Windows packaged screenshots include a display ICC profile and must be converted to sRGB before comparing RGB values with browser/native reference captures.

This release includes a verified source archive. Detailed local reference captures, geometry fixtures, scoped pre-change backups, unified patches and test logs are retained in the Quick Scan project workspace under analysis/quick-scan-v1.1.55 through analysis/quick-scan-v1.1.58.
