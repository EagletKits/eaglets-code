import { cpSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Blockly loads its sprites and cursors from static.blockly.com unless told
// otherwise. Copy them from the npm package into public/ so the app never
// contacts a third-party server (the privacy policy promises that).
function blocklyMedia(): Plugin {
  return {
    name: 'eaglets-blockly-media',
    buildStart() {
      cpSync(fileURLToPath(new URL('./node_modules/blockly/media/', import.meta.url)), fileURLToPath(new URL('./public/blockly-media/', import.meta.url)), { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), blocklyMedia()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: { port: 5173, strictPort: false },
  // Blockly alone is ~1 MB; the app is meant to load once and run locally.
  build: { chunkSizeWarningLimit: 1600 },
});
