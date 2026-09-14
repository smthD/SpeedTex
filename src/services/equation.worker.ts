import { mathjax } from '@mathjax/src/mjs/mathjax.js';
import { renderEquation } from './equation-renderer';
// Vite emits font chunks locally. No CDN, runtime package loader, or document HTML.
const fonts = import.meta.glob(
  '../../node_modules/@mathjax/mathjax-newcm-font/mjs/svg/dynamic/*.js',
);
mathjax.asyncLoad = (name: string) => {
  const file = name.split('/').at(-1)!.replace(/\.js$/, '');
  const load = fonts[`../../node_modules/@mathjax/mathjax-newcm-font/mjs/svg/dynamic/${file}.js`];
  if (!load) return Promise.reject(new Error('Unsupported font extension'));
  return load();
};
let chain = Promise.resolve();
self.onmessage = ({ data }: MessageEvent<{ id: number; tex: string }>) => {
  chain = chain.then(async () => {
    try {
      self.postMessage({ id: data.id, ...(await renderEquation(data.tex)) });
    } catch (e) {
      self.postMessage({ id: data.id, error: (e as Error).message || 'Invalid LaTeX' });
    }
  });
};
