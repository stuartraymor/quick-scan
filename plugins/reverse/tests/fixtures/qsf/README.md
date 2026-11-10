# Authored QSF regression fixtures

These two 20,415-byte projects were authored for Quick Scan comparison tests in QUICKSURFACE Pro 8.0.128 using our generated radius-10 cylinder mesh. They contain a datum plane, circle sketch, driving diameter and 12 mm extrusion. The second project changes the diameter from 20 to 18 and regenerates the extrusion.

These are user-authored data files, not proprietary program code or application assets. Original analysis evidence: `analysis/parity-campaign-0.0.114/cylinder/`. Printable ASCII and UTF-16 strings were inspected before inclusion: only authored object names and generic Parasolid transmit/schema metadata were found; no personal paths or secrets. Transmit USER/SITE/DATE fields are `unknown` and KEY is `UNKNOWN`.

- cylinder-solid.qsf SHA-256: `33fa9c57920a6127ebf4831f46ea1b2ef3dcc6dac78245b17f2c34234fbb3558`
- cylinder-regenerated18.qsf SHA-256: `f79f24fed8e9c95c42a0f6a5de03fd2765a1cec1ff4fae98459a9bb8d09a21da`

The importer reconstructs the measured sketch/extrude history. It does not decode the redundant Parasolid cache. These fixtures do not establish support for arbitrary native constraints, freeform settings, or other QSF versions.

The 24,103-byte preserved-three-sketches.qsf fixture contains the same generated scan, two reference sections (including X=2), and two lines sharing a constrained start point. Controlled native visibility toggles and endpoint dragging established the supported state. Printable strings contain only authored object names; no personal paths or secrets were found. SHA-256: 1ec0c1f12b7ce0a1bcca885d7e3d7f0e29573c6a725b2dc496132e3b47ed38e4.
