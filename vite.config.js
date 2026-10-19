import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';

export default defineConfig({
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
