import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root: here('./'),
  base: './',
  build: {
    outDir: here('../dist-extension'),
    emptyOutDir: true,
    target: 'chrome121',
    rollupOptions: {
      input: { background: here('background.ts'), manager: here('manager.html') },
      preserveEntrySignatures: 'strict',
      output: { entryFileNames: '[name].js' },
    },
  },
});
