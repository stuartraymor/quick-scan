# New Freeform cycle1.1.81

## Scope and current status

Three related changes: separate manual cage/history commits from CAD rebuild completion; replace repeated edge-to-face searches for rectangular freeform bodies; blend measured colors consistently during preview/fallback while bounding synchronous large-cage queries. No automatic-freeform algorithm, project schema, command schema or external protocol changed. Independent source/assets; installed native behavior and existing native geometry fixtures used as reference. Full parity is false.

## Evidence

- Preserved the user's newest **101-face** Freeform4 project with all five surfaces before testing. Archive SHA256 `5a4749890f1a20ea470ac0f2630a7167ab23836806b22e787083bc542e0a95a1`. The benchmark deliberately uses the previous100-face archive for a matched100→101comparison. Never restore that older benchmark over the user's101-face work.
- Baseline:12,650ms release-to-finished display; worker build9,234ms, reference extraction1,583ms, distance measurements827ms. CPU samples located approximately7seconds in edge-incidence lookup. See `baseline-large`.
- Optimized CAD construction:2,409–2,651ms across recorded runs. Identical feature positions/faces/creases after the sameDgesture. Rectangular incidence regression equals the original kernel edge records and boundary length for planar, closed and toroidal cages.
- Corrected a transient stale-result handoff: the finished scene's position buffer must be the session's latest mesh before it can supply finished tolerance colors. The early3,186ms run observed an old cached result and is **not** a valid completed-analysis timing. Stable reruns:6,800/6,903ms including600ms stabilization; see `verified-large` and `responsive-large`.
- Consecutive large-cage D gestures100→101→102 plus Undo→101 and Redo→102 work while the first CAD answer is deliberately held. Only two builds are requested for four edits; final geometry persists, two Undo steps restore the exact starting document.567recorded frames: no missing/shaded tolerance surface. First post-release paint417.7ms; controls enabled during rebuild. See `consecutive-large/result.json`.
- Preview sample queries now use the evaluated shared vertices directly above512refined faces. These are actual signed measurements, explicitly labeled preview. Finished CAD retains its independent dense samples, numerical statistics and thresholds. This is a bounded interactive approximation, not finished CAD certification.
- Four curved joins match native coordinates within8.139e-7mm with exact faces/creases; history and reopening pass. Fresh native tolerance captures reproduce previous curved chroma RMS:0.03280 at0.01mm,0.17029 at0.02mm,0.03511 at0.04mm,0.00671 for Pass/Fail. The0.02mm discrepancy remains, and finished chart colors were not artificially altered to hide it.

## Limits and next useful investigation

Instant large-part response is **not achieved**: measured post-release paint remains approximately0.42seconds and final CAD/tolerance calculation takes several seconds. The editor is usable during that work. Next: profile the renderer's release-frame subdivision/projection/measurement and retain unchanged evaluated regions rather than rebuilding the entire preview. Reference extraction remains approximately2seconds and should be evaluated independently. The initial cold New Freeform entry issue, arbitrary/ray/depth/zoom joins, near-join evaluated surface shape, branched irregular repairs and full icons/legend/options parity remain open. No unsupported reference behavior is claimed as implemented.

## Verification

Full source suite:4,408passed,42existing fixture skips. Desktop48 and MCP127pass. Production build, packaged smoke, four packaged curved joins, aligned seam, D free pull/snap, Undo/Redo and fresh-process reopening pass. Installed EXE/ASAR hashes match the immutable release. Focused connectivity/scheduling/stop regressions:23passed. Editor-layer suite:102passed after correcting the new fixture's direction vectors and drag distance; the first two test attempts were invalid fixtures, retained in tool history. Existing assertions were not weakened. Browser curved comparison passes. Remaining build/package/install checks are recorded beside this report.

## Installed acceptance

The latest101-face user project is restored clean, five surfaces, Freeform4 selected, inches, Points/Edges, D ON, Control Net OFF and neighbours OFF. Finished measurements remain Min−0.0440in / Max+0.0205in / RMS0.0022in. Actual101-face visual test:44,239complete normals,152recorded frames without a missing/shaded tolerance surface, exact geometry preserved. Full-suite activity overlapped this visual check, so its frame timing is not an isolated performance benchmark. Native user document/view restored. Fifth passing local cycle after public1.1.76; publication cadence is due. Full parity remains false.
