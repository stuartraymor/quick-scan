# Quick Scan — handover for the QUICKSURFACE review partner

Thank you for reviewing Quick Scan. This page tells you how to install it from GitHub, what we would like you to compare against QUICKSURFACE, and how to send your findings and any changes back to us.

## 1. What Quick Scan is

Quick Scan is a Windows reverse-engineering application for 3D scans (STL, OBJ, PLY, 3MF, STEP): fit primitives, cut sections, sketch, build CAD bodies and compare them with the scan. It is built on the open-source [ScanRuler](https://github.com/CNCKitchen/ScanRuler) (AGPL-3.0-only).

Our goal is that an experienced QUICKSURFACE user feels at home: the same command positions and names, the same dialogs, the same selection → preview → Apply/Cancel workflow, and the same mouse controls. Quick Scan is an independent product. It is not affiliated with or endorsed by KVS Ltd / QUICKSURFACE.

**Your review is the most useful thing we can get: side-by-side, command-by-command differences from someone who uses QUICKSURFACE daily.**

## 2. Install

Requirements: Windows 10 or 11, 64-bit. No administrator rights needed (it installs for the current user).

1. Open the [latest release](https://github.com/stuartraymor/quick-scan/releases/latest) and download `Quick-Scan-Setup-<version>.exe` and its `.sha256` file.
2. *(Recommended)* Check the download is intact. In PowerShell, in your Downloads folder:
   ```powershell
   Get-FileHash .\Quick-Scan-Setup-0.0.14.exe -Algorithm SHA256
   ```
   The hash must match the one in the `.sha256` file and in the release notes.
3. Run the setup. The installer is **not code-signed yet**, so Windows SmartScreen may say "Windows protected your PC". Click **More info → Run anyway**.
4. Follow the wizard. Setup closes any running Quick Scan first and installs over an older version.
5. Start **Quick Scan** from the Start menu.

**Updates.** Help → **Check for Update** (or the Quick Scan menu at the top left) downloads the newest GitHub release, verifies its SHA-256 and reinstalls. Please note the version you reviewed (title bar, or Help → About) in every report.

**Uninstall.** Windows Settings → Apps → Quick Scan → Uninstall. Your project files are not touched.

**Privacy.** Scans and projects stay on your computer. The optional **AI** tab connects to an AI app on the same computer only when you switch it on; leave it off unless you want to test it.

## 3. What is ready to compare (v0.0.14)

| Area | Where in Quick Scan | Status |
|---|---|---|
| Ribbon layout | Main tab: File, Scan Data, Primitives, Align, Cross sections, Surfacing, Freeform, Part Design, Analysis, Export Model | Labels and order taken from QUICKSURFACE Pro 8.0.127 screenshots |
| Construct menu | Main → Construct ▾ | Entry for entry; unbuilt entries are shown greyed out |
| Extract primitives | Main → Extract primitives | Dialog: select the area (Magic Wand 0.1–10°, brush, free hand, rectangle, select through, select all connected, enlarge, shrink, isolate, hide, show all, deselect, invert), then click plane / cylinder / line / cone / sphere. Quick tools appear beside a wand pick |
| Align | Main → Align ▾ | Align by Coordinate System, Align Interactive (numeric editor, no on-model gizmo yet), By N points, Fine-align reference mesh |
| 2D Sketch | Main → 2D Sketch | Create Sketch: OXY/OYZ/OXZ or Pick, offset, draggable yellow arrow with the cut outlined live, Create & Stay, Stacked sections, Hide scan data; then the sketch editor |
| CAD | Main → Part Design, CAD tab | Extrude, Revolve, Move face, Trim, Pattern, Mirror, Fillet/Chamfer, Delete Faces, Helix/Thread, Combine |
| Analysis | Analysis tab | Measure, Compare, Compare to other meshes, Snapshot to clipboard. Surface Area, Volume, Zebra, Environment Map and Draft are placeholders |
| Mouse | Settings → mouse controls | QUICKSURFACE scheme is the default: middle = rotate, Ctrl+middle = pan, Shift+middle = zoom |
| File | Quick Scan menu (top-left logo) | New, Open, Import scan, Import CAD (STEP), Save, Save as, Export model, Export scan data, recent documents |

Known gaps — please don't spend long confirming these, but do tell us how QUICKSURFACE behaves if you can: Free Form / Auto Surfacing (SubD), Align Interactive gizmo, the rest of the Create Sketch options (Define interactive, snap, ignore scan data, flip, through selection only, outline mesh, revolved), more than one mesh in a project (import adds, compare to other meshes, global fine align, merge), IGES, Zebra / Environment Map / Draft / Straightness analysis, mesh Scale, Pipe / Sew / Extend / Fill / Blend surfaces.

The full command-by-command comparison we keep is in [`QUICKSURFACE_FEATURE_AUDIT.md`](QUICKSURFACE_FEATURE_AUDIT.md) — use it as your checklist.

## 4. How to review

For each command, do the same task in both applications on the same part and note every difference you would notice as a QUICKSURFACE user:

- **Placement and naming** — tab, group, button, menu entry, label text, icon meaning.
- **Dialog** — fields, their order, defaults, units, checkboxes, buttons (Apply / OK / Cancel / Close / Create & Stay).
- **Workflow** — what you select first, what previews, what Apply/Cancel/Escape do, what stays open, what appears in the Objects tree and the History.
- **Mouse and keyboard** — clicks, drags, modifiers, shortcuts.
- **Result** — the geometry or numbers produced (where you can compare).
- **Feel** — anything slow, jumpy or confusing.

Please use your own test parts. Do not send us customer data you are not allowed to share.

## 5. What to send back

### Findings (everyone)

One item per difference, either as a [**QUICKSURFACE parity finding** issue](https://github.com/stuartraymor/quick-scan/issues/new?template=parity.yml) (the form asks for every field below and labels it `parity`), or collected in one spreadsheet using [docs/parity-findings-template.csv](parity-findings-template.csv). For each item:

| Field | Example |
|---|---|
| ID | QS-012 |
| Area / command | Extract primitives → Magic Wand |
| QUICKSURFACE behaviour | After a wand click the quick-tools box appears; dragging its slider grows the selection |
| Quick Scan behaviour (version) | v0.0.14: same, but the box appears 40 px further right |
| Steps to reproduce | Open part X, Extract primitives, wand, click the top face |
| Severity | Blocker / Major / Minor / Cosmetic |
| Suggested change | Place the box at the cursor |
| Evidence | Your own screenshot or screen recording (timestamp) of each application |

Screenshots and recordings of what you see on screen are exactly what we need.

**Please do not send:** QUICKSURFACE installers, program files, DLLs, icons, templates, sample files, manuals or other documents, or anything obtained by decompiling or disassembling it. Describe behaviour and show screenshots instead. We build every feature independently, and this keeps both of us within the QUICKSURFACE licence terms.

### Code changes (if you change Quick Scan itself)

1. Agree the contribution terms with Stuart Raymor **before** sending code. Quick Scan is AGPL-3.0-only; the `CLA.md` in the repository is the upstream ScanRuler agreement and is **not** what applies to this review unless Stuart tells you so.
2. Fork [stuartraymor/quick-scan](https://github.com/stuartraymor/quick-scan), make one branch per change, and open a pull request. Alternatively send a `git format-patch` series or a zip of the changed files with a short note per change.
3. Keep original work only: no copied QUICKSURFACE assets, icons, text or code, and no GPL/LGPL code.

Building from source (Node.js 22 or newer):

```powershell
git clone https://github.com/stuartraymor/quick-scan.git
cd quick-scan
npm ci
npm run dev          # opens on http://localhost:5173 in a browser
npm test             # unit tests
npm run build        # type check + production build
node package-desktop.mjs   # the Windows app, in desktop-build\
```

`installer\build-installer.ps1` builds a setup program from the packaged app (needs Inno Setup 6). Please run `npm test` and `npm run build` before sending changes, and include a screenshot of the result for any UI change.

## 6. Contact

Send findings and questions to Stuart Raymor (through the GitHub issues on [stuartraymor/quick-scan](https://github.com/stuartraymor/quick-scan/issues), or by the channel you agreed). Please include the Quick Scan version in every message.
