# QuickSurface project import

QSF support is experimental and deliberately limited. Open a `.qsf` file through
Open Project or drag it into Quick Scan. Supported records are converted into
editable Quick Scan features. Save creates a `.scanruler` copy; it does not
overwrite the original QuickSurface file. The converted project retains the
original QSF bytes for provenance.

The verified subset includes a scan mesh, measured sketch planes, line/circle
sketch geometry, measured driving-diameter and shared-start-point coincidence
constraints, and a linked
one-sided extrusion. Native feature order and supported visibility states are
preserved. Only measured frame variants are accepted.

This is not general QuickSurface compatibility. Freeform surfaces, fitted
surface history, arbitrary Parasolid bodies, splines, and unverified constraint
or feature settings remain unsupported. An unsupported record rejects the
whole import before replacing the current project. Keeping source bytes does
not make an unsupported feature editable.

Validation includes real native fixtures, CAD regeneration and volume checks,
source-byte retention, Open/Save/reopen, and refusal without changing the current
document. Geometry being visually similar is not sufficient evidence that
constraint behavior or construction history has been preserved.
