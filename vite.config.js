import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';

export default defineConfig({
  // Relative paths, so the build works from any folder (GitHub Pages serves it under /smart-city-digital-twin/).
  base: './',
  // Dev and preview on 8071; smart-city.nuscode.id is the tunnel to it.
  server: {port: 8071, allowedHosts: ['smart-city.nuscode.id']},
  preview: {port: 8071, allowedHosts: ['smart-city.nuscode.id']},
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        penjelasan: fileURLToPath(new URL('./penjelasan.html', import.meta.url)),
        desainTeknis: fileURLToPath(new URL('./desain-teknis.html', import.meta.url)),
        diagram3d: fileURLToPath(new URL('./diagram-3d.html', import.meta.url)),
        aset: fileURLToPath(new URL('./aset.html', import.meta.url)),
        editorPeta: fileURLToPath(new URL('./editor-peta.html', import.meta.url)),
      },
    },
  },
});
