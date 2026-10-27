import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { editorAssets } from './scripts/editor-assets.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  appType: 'mpa',
  publicDir: false,
  plugins: [tailwindcss(), editorAssets(root)],
  resolve: {
    alias: {
      '@/types': resolve(root, 'src/js/types/index.ts'),
      '@': resolve(root, 'src'),
    },
  },
  define: { __ENGINE_VERSION__: JSON.stringify('051abe5b72a9') },
  optimizeDeps: { exclude: ['bentopdf-pdfium'] },
  server: {
    host: 'localhost',
    headers: isolationHeaders,
    open: '/editor.html',
  },
  preview: {
    host: 'localhost',
    headers: isolationHeaders,
    open: '/editor.html',
  },
  build: {
    outDir: 'dist-editor',
    emptyOutDir: true,
    rollupOptions: { input: resolve(root, 'editor.html') },
  },
});
