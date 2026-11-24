import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: false },
  // Blockly alone is ~1 MB; the app is meant to load once and run locally.
  build: { chunkSizeWarningLimit: 1600 },
});
