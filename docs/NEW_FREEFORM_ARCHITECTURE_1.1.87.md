# Follow-up to the New Freeform reconstruction

The editable cage, evaluated control surface, measured field and completed CAD remain separate as established in 1.1.86. This cycle fixes a release boundary where Control Net OFF used visible limit anchors for dragging but projected raw poles on release. On a shared boundary, those points are different. The local inverse limit response now places the selected visible anchors on closest scan points, without snapping the surface interior or changing topology. Control Net ON retains pole editing. Ray Projection retains its existing path and is not newly certified.

The solve runs on release. Held motion performs no added scan queries. Selections up to 64 use the existing local response solver; larger selections use bounded sparse corrections. Null/nonfinite correspondence rejects the complete edit. Native contact fitting remains a separate operation after contact detection, and existing curved joins retain their saved numerical results.

Tolerance gets a viewport scale independent of the measured surface, with current signed thresholds and units. The scale remains present during candidate placement and pointer movement. It reports no invented deviations and does not change measured values, color interpolation, lighting or geometry. Black outside-scale and gray reverse-side appearance are explained. Mesh Display/Opacity/Offset survive editor close/reopen during the session; project schemas are unchanged.

Remaining architecture work: native non-contact curved deformation equivalence; exact multi-patch surface agreement; every-frame first movement; faster final CAD and release updates; broader ray joins and complex repairs. The 1.1.86 timings remain the performance baseline unless superseded by a new measured run.
