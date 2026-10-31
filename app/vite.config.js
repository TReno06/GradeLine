import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Checkpoint 1 (PLAN.md Stage 2): the delivered artifact must stay a
// single self-contained HTML file, exactly like tinviewer.html today —
// double-click, offline, no server. viteSingleFile() inlines all JS/CSS
// into index.html on build; nothing else in this config should change
// that guarantee.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    target: 'es2020',
    assetsInlineLimit: 100000000, // inline everything (icons etc.), no loose files
    cssCodeSplit: false
  }
});
