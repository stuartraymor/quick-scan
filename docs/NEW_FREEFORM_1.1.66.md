# New Freeform comparison update 1.1.63–1.1.66

Four installed and tested cycles compare manual New Freeform with QUICKSURFACE Pro 8.0.128 using controlled synthetic geometry. Full equivalence remains incomplete.

- **1.1.63:** Boundary-point contact previews Merge and welds shared topology. Five saved native cases match oriented faces exactly and poles within 3.77e-7 mm. Four packaged edit/history/fresh-process reopen cases pass. Deformed finished-CAD plane measurements agree within 1.193e-9 mm. Pass/Fail image classification agrees on 99.05% of comparable pixels.
- **1.1.64:** Open edge-chain contact welds one endpoint and retains chain selection. Native Control Net ON/OFF outputs agree. Both packaged cases match native poles within 9.619e-7 mm. Empty contextual Delete dismisses without creating history.
- **1.1.65:** With Control Net OFF, Snap OFF and Don't move neighbours ON, direct point movement preserves neighbouring evaluated surface anchors. Final seam closure uses the moved precontact anchors. Six browser and packaged cases match exact oriented faces, with packaged pole error below 1.605e-6 mm. Undo/Redo and fresh-process reopening pass. Gradient comparison median maximum channel error is 4, with a 95th percentile of 67; transitions remain inexact.
- **1.1.66:** Independently drawn face-brush, circular-smoothing and spherical Shaded/Tolerance/Zebra icons improve correspondence while preserving order and actions. Both brush entry workflows, Back, display switching, chain edits and persistence pass.

Final validation: 4,341 source tests passed, 42 external-fixture skips; 48 desktop and 127 MCP tests passed. TypeScript, production build, plugin boundary, display units, manual editor regression and packaged CAD smoke passed. Installed executable and ASAR hashes match the packaged manifest. MCP command schemas are unchanged.

The initial last packaged 1.1.65 case unexpectedly included a separate repair operation. Its artifact was retained; an instrumented rerun passed with the intended canvas drag and history inputs. The cause remains unconfirmed. Desktop screenshots contain monitor ICC profiles and must be normalized before numeric RGB comparison.

Open work includes broader snapping near holes and disconnected components, arbitrary irregular-point repair, three-sided closure, constrained and neighbour-influenced Merge, brush falloff calibration, exact visual transitions and the remaining reference matrix. Icon assets are independent drawings, not extracted proprietary resources. These checks do not certify full production equivalence.
