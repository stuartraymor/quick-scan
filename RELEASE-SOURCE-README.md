# Quick Scan 0.0.38 corresponding source

Based on the source archive attached to v0.0.31; the upstream tag itself points at older source. Original dirty checkout was preserved.

Node22+, npm ci, npm run build; node package-desktop.mjs; installer/build-installer.ps1. Exact reference samples are local inputs under public/reference-examples, separately excluded from source control. The comparison installer retains their original catalog hashes.

This is a local parity checkpoint, not a claim of complete QuickSurface parity. Adds persistent explorer actions (0.0.36), core plane/section Edit (0.0.37), and top-right cube/navigation/coordinate/grid controls (0.0.38), preserving the dark theme. Installer native acceptance is recorded separately in the accompanying output report. Source contains actual geometry/camera actions, not simulated controls.
