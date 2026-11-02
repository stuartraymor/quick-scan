# Quick Scan 0.0.39 corresponding source

Based on the source archive attached to v0.0.31; the upstream tag itself points at older source. Original dirty checkout was preserved.

Node22+, npm ci, npm run build; node package-desktop.mjs; installer/build-installer.ps1. Exact reference samples are local inputs under public/reference-examples, separately excluded from source control. The comparison installer retains their original catalog hashes.

This tested release adds unified Objects/History, persisted common order, actual rollback and restoration, dependency viewing, synchronized visibility, existing-object editing and guarded deletion, plus the navigation corner improvements. The dark blue and white theme is retained. See RELEASE-VERIFICATION.md for results and limits, including read-only partial timelines and incomplete full QuickSurface parity.

SOURCE-HASHES.json records SHA-256 for every other file in the attached normalized-LF source archive. Rebuilding requires the documented local reference samples; the source archive excludes those sample assets. The Windows installer includes all ten samples, verified against their original catalog hashes.
