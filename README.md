# GradeLine

A free, self-contained app for a single survey workflow: read survey DXF
data, build a TIN surface, cut a long section along an alignment, and lay a
straight-grade driveway design over it with AS/NZS 2890.1:2004 compliance
checks.
It's a lightweight, no-install alternative to 12d Model / Civil3D for that one
job, not a general CAD replacement.

## Get it

- **Windows desktop app:** download `GradeLine_x.y.z_x64-setup.exe` from the
  [latest release](https://github.com/TReno06/GradeLine/releases/latest) (also
  kept in [`releases/`](releases/) in this repo) and run it. It installs for
  your user only, so no admin rights are needed. The installer isn't
  code-signed, so Windows may say "Windows protected your PC": choose **More
  info → Run anyway**. The first time you double-click a `.gradeline` job,
  Windows asks which app to use: pick GradeLine and **Always**. This is the
  only way to install GradeLine as an app.
- **Single HTML file:** download `GradeLine.html` from the
  [latest release](https://github.com/TReno06/GradeLine/releases/latest) (or
  [`releases/GradeLine.html`](releases/GradeLine.html) here) and open it in
  Chrome or Edge. It's one self-contained file: no install, no server, works
  offline.
- **In the browser:** <https://treno06.github.io/GradeLine/>, to try it without
  downloading anything.

## Features

- DXF input (`POINT`, `3DFACE`, contour and alignment polylines), a layer
  filter that flags layers sitting away from the rest of the survey
- Breaklines: 3D `LINE`, `ARC` and 3D polyline linework (kerbs, gutters) is
  built into the TIN, so a kerb keeps its face instead of becoming a ramp
- 3D TIN surface view, long section with grade breaks and a chainage/RL ladder
- Driveway design: straight-grade/PVI model, kerb and layback templates,
  AS/NZS 2890.1:2004 domestic driveway checks (25% maximum, 5% at the property
  line, 2.5% across the footpath, summit/sag transitions), the Figure C1
  B85/B99 ground clearance check, and an approximate cut/fill volume
- Crossfall between two alignments: a cross-section square across the
  driveway at any design chainage
- A built-in sample job (curved street, kerb with layback, sloping lot, two
  driveway edges) to try every feature
- Light and dark themes
- Exports: long section CSV/DXF, TIN surface DXF, crossfall DXF, PDF of the
  current screen
- Save and reopen jobs as `.gradeline` files

The driveway checks are a screening aid, not a substitute for a proper design
or a council's own requirements.

## Development

The source is a Vite + TypeScript project in `app/`. The build produces a
single inlined HTML file.

```sh
cd app
npm ci
npm run build              # typecheck + build + copy to ../tinviewer.html
node test/run_tests.mjs    # unit tests (Node 22.18+ for native TS type stripping)
```

`tinviewer.html` is the build output; each release copies it to
`releases/GradeLine.html`. Pushing to `main` deploys `app/dist` to GitHub
Pages (`.github/workflows/deploy-pages.yml`) as a plain website.

`desktop/` is the Windows desktop app: a [Tauri 2](https://tauri.app) shell
around the same `app/` build. With Rust and the Visual Studio C++ Build Tools
installed:

```sh
cd desktop
npm ci
npm run build   # builds app/ first; installer lands in src-tauri/target/release/bundle/nsis/
```
