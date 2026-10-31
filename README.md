# GradeLine

A free, self-contained browser app for a single survey workflow: read survey
DXF data, build a TIN surface, cut a long section along an alignment, and lay
a straight-grade driveway design over it with AS 2890.1 compliance checks.
It's a lightweight, no-install alternative to 12d Model / Civil3D for that one
job, not a general CAD replacement.

**Use it:** <https://treno06.github.io/GradeLine/>. In Chrome or Edge you can
install it as an app (it then works offline and opens `.gradeline` job files).
Or download [`tinviewer.html`](tinviewer.html) and open it directly: it's one
self-contained file with no server and no network access needed.

## Features

- DXF input (`POINT`, `3DFACE`, contour and alignment polylines), layer filter
- 3D TIN surface view, long section with grade breaks and a chainage/RL ladder
- Driveway design: straight-grade/PVI model, kerb and layback templates,
  AS 2890.1 (1993) grade and transition checks, a B85/B99 vehicle scrape
  check, and an approximate cut/fill volume
- Crossfall comparison between two alignments
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

`installer/` packages `gradeline.html` (a copy of `tinviewer.html`) with
PowerShell scripts that add Desktop and Start Menu shortcuts without needing
admin rights. Pushing to `main` deploys `app/dist` to GitHub Pages
(`.github/workflows/deploy-pages.yml`).
