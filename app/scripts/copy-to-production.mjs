// PLAN.md Stage 2 final cutover (2026-09-19): app/'s Vite build is now
// the production file, not tinviewer.html hand-edited directly. This
// runs as `npm run build`'s own last step (see package.json) so editing
// app/src/*.ts and building is the whole workflow again — no separate
// manual copy step to forget, matching how the old no-build workflow
// only ever had one file to edit in the first place.
import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(appDir, 'dist', 'index.html');
const dest = join(appDir, '..', 'tinviewer.html');
copyFileSync(src, dest);
console.log('Copied', src, '->', dest);
