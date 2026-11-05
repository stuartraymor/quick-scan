# Quick Scan 0.0.120 verification

Quick Scan 0.0.120 is the Windows update from four installed comparison passes since 0.0.114.

- **Fit planes.** Auto Constrain can hold the first nearly aligned plane to a coordinate plane and displays the effective relation. Picking a manual relation disables Auto. On tilted caps the two programs agreed on the 0.30° hold and the 1.20° free fit.
- **Extrude.** Positive Depth 2 adds material behind the sketch. Editing Full depth resizes both sides proportionally. On the test cylinder, 12 + 2 gives 14 mm, and changing the total to 16 gives 13.714286 and 2.285714 mm. Signed legacy offsets, reversed direction, parameter expressions and inch inputs were checked by saving, reopening and measuring the resulting STEP solids.
- **Create Sketch and Fit Circle.** Clearing Create sketch on slicing plane keeps the cross-section from the offset plane and draws it on the picked datum. On the same cylinder both programs produced a solid from Z=5 to Z=17 mm. A fitted circle draws solid black after mouse release and after returning to Edit Sketch.
- **Outline Mesh.** The preview and Create use the same projected reference points. On an OXY plane at Z=8 mm above the cylinder, Quick Scan saved and reopened a fitted circle with radius 9.998716125 mm. QUICKSURFACE measured 10.000000264 mm. The outline uses the mesh boundary, while the separate Shadow command retains its machining clearance.
- **Examples.** Datum block, Sketch profiles and Fridge bracket ship in the installer. All ten reference menu entries also loaded from the mapped local library on the test PC. Choose the Quick Scan icon, then Settings, to set that folder on another computer.

The Windows build, packaged desktop smoke, installed workflow checks and file/update tests passed. The full suite passed 3,408 tests with 24 skipped; the separate desktop suite passed 16 tests. The installer SHA-256 is 1788eed13fb522e814eed02bfa561dc86ef29a315f6ee3fb8406d63bc13b2ba4.

This release covers measured workflows on the shared cylinder and tilted-cap fixtures. Exported cylinder topology still differs (four native faces versus three in Quick Scan), as do free-fit sample positions. Primitive graphics, mixed-part datum alignment, sketch modification and freeform workflows remain under comparison. Quick Scan keeps its dark theme and AI tools.


The identical 640-triangle input used for the paired cylinder was workflow-cylinder-r10.obj (SHA-256 705a33aed997598451bdab9418796811baaf5dbf3ed75389f02f7bffb6fb04cc). Both applications imported this mesh, fitted a datum, picked it in the viewport, fitted a circular sketch, drove its diameter, extruded 12 mm, saved, reopened and regenerated after a dimension edit. At Ø20 the exported volumes differed by 1.65e-10 mm³, and at Ø18 by 4.81e-8 mm³. Separate downstream edit trials used native project checkpoints from that import.

The new Outline Mesh test placed its plane outside the measured surface. A previous candidate drew a machining allowance and gave radius 11.098274345 mm. The corrected result contains 1,601 reference entries including the closing entry, with 1,600 distinct fit samples. Each lies on the faceted cylinder boundary to within 0.002 mm of nominal. Native point identities and fitting weights were unavailable. The measured radius difference is 0.001284139 mm. The manufacturing Shadow section and its allowance were covered by separate existing regressions. A new projected plate test exercised its outside perimeter and through-hole on a plane above the scan.
