// Release build for the desktop app: `npm run build` in desktop/.
//
// Runs `tauri build` with rustc's --remap-path-prefix set for this
// machine's home and checkout directories. Without it, panic-location
// strings embed absolute source paths (e.g. the .cargo registry under the
// home folder) into the shipped exe, publishing the build machine's user
// name. Cargo's
// own `trim-paths` profile option would do this, but isn't stable yet.
// Paths are worked out here at build time so no user name is committed.
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = path.resolve(desktopDir, '..');
const remaps = [
  `--remap-path-prefix=${repoDir}=gradeline`,
  `--remap-path-prefix=${os.homedir()}=~`,
];
const env = { ...process.env, RUSTFLAGS: [process.env.RUSTFLAGS, ...remaps].filter(Boolean).join(' ') };

const result = spawnSync('npx', ['tauri', 'build', ...process.argv.slice(2)], {
  cwd: desktopDir, env, stdio: 'inherit', shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
