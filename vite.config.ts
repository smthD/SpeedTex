import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  worker: { format: 'es' },
  optimizeDeps: { include: ['nspell'], exclude: ['@mathjax/src', '@mathjax/mathjax-newcm-font'] },
});
