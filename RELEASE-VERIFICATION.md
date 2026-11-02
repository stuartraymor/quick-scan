# Quick Scan v0.0.43 â€” One-button AI setup

Open AI â†’ Rebuild with AI â†’ Set up my AI app. Quick Scan configures installed Claude Code, Claude Desktop and Codex, shares the connector pairing values and reports each result. Existing settings are merged and backed up. Restart the AI app once after setup. Node.js 22+ and npx must already be installed.

The existing data-sharing warning remains required. Accepted consent and the connection's on/off choice survive later Quick Scan version updates. Waiting and refused connections now show actionable guidance, and rerunning setup repairs mismatched pairing values. Browser users retain manual setup instructions.

## Verified

- Full unit/regression suite: 3,300 passed, 0 failed, 24 skipped across 410 files.
- Real connector browser workflow: setup, consent, session read, new-version profile restoration, remembered off, actual token refusal and setup repair passed. Deliberate pre-start connection failures are recorded separately; no unexpected console errors.
- Existing consent browser regression passed, including decline/Escape and reloading without repeat consent.
- TypeScript, production build and plugin-boundary checks passed.
- Packaged Windows smoke passed: native preload/IPC setup configured all three fixture apps, and OBJ import, save, reopen and OCCT initialization succeeded with no app errors.

All setup tests used isolated configuration folders. The user's actual AI-app configuration was not changed by testing. Interactive fresh-user restarts of all three third-party clients remain a manual follow-up. Managed client policies and disabled-server choices can require additional client action.

## Included sketch improvements and remaining differences

Includes the local sketch increments since v0.0.39: a circular section-point brush with seven fit types and live previews, revised original SVG control rows, multi-entity constraints and on-canvas dimension editing, original-line drag guides, and independent mirror/duplicate/offset/trim/slot tools. The sketch controls and brush suites passed 47 and 18 browser checks respectively.

This release does **not** certify an exact QuickSurface copy. The audit still finds differences in Create Sketch/stacked-section semantics, Auto Join, Corner Trim, Sketch assist, projection, curved offsets, tangent-arc workflow, reference-point cleanup, IGES export and some display/manipulation controls. Those controls/workflows are the next development task. No proprietary QuickSurface source or icons are shipped.

The unsigned Windows installer and its SHA-256 are attached, with corresponding AGPL source, source hashes and validation notes. Builds 0.0.40â€“0.0.42 were local review increments; existing installed sessions were not replaced during this task.
