import { mathjax } from '@mathjax/src/mjs/mathjax.js';
import { TeX } from '@mathjax/src/mjs/input/tex.js';
import { SVG } from '@mathjax/src/mjs/output/svg.js';
import { liteAdaptor } from '@mathjax/src/mjs/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from '@mathjax/src/mjs/handlers/html.js';
import { STATE } from '@mathjax/src/mjs/core/MathItem.js';
import { MathJaxNewcmFont } from '@mathjax/mathjax-newcm-font/mjs/svg.js';
import '@mathjax/src/mjs/input/tex/ams/AmsConfiguration.js';
import '@mathjax/src/mjs/input/tex/physics/PhysicsConfiguration.js';
import '@mathjax/src/mjs/input/tex/mathtools/MathtoolsConfiguration.js';
import '@mathjax/src/mjs/input/tex/boldsymbol/BoldsymbolConfiguration.js';
const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
// Compare notation trees, not TeX spelling or arbitrary algebraic equivalence.
function notation(node: any): unknown {
  if (node.kind === 'text') return node.getText();
  if (node.kind === 'merror') throw new Error('Incomplete or unsupported LaTeX');
  if (node.kind === 'mspace') return null;
  const children = (node.childNodes || []).map(notation).filter((child: unknown) => child !== null);
  if (['math', 'mrow', 'inferredMrow', 'TeXAtom'].includes(node.kind))
    return children.length === 1 ? children[0] : children;
  return [node.kind, node.attributes?.getExplicit('mathvariant') || '', ...children];
}
export async function renderEquation(tex: string) {
  if (tex.length > 10000) throw new Error('Equation is too long');
  const input = new TeX({
    packages: ['base', 'ams', 'physics', 'mathtools', 'boldsymbol'],
    maxBuffer: 10000,
    maxMacros: 1000,
    formatError: (_jax: unknown, error: Error) => {
      throw error;
    },
  });
  const output = new SVG({ fontData: MathJaxNewcmFont, fontCache: 'none' });
  const doc = mathjax.document('', { InputJax: input, OutputJax: output });
  const tree = doc.convert(tex, { display: true, end: STATE.COMPILED });
  const fingerprint = JSON.stringify(notation(tree));
  const node = await doc.convertPromise(tex, { display: true });
  return { svg: adaptor.outerHTML(node), fingerprint };
}
