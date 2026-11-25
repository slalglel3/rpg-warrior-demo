import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const isSingle = process.env.SINGLE_FILE === '1';

export default defineConfig({
  base: './',
  plugins: isSingle ? [viteSingleFile()] : [],
  build: {
    outDir: isSingle ? 'dist-single' : 'dist',
    emptyOutDir: true,
    assetsInlineLimit: isSingle ? 100_000_000 : 100_000,
    target: 'es2022',
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
});
