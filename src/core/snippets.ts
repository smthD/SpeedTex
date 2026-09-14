import type { Context } from './context.ts';
export interface Snippet {
  id: string;
  name: string;
  trigger: string;
  replacement: string;
  context: 'everywhere' | 'math' | 'text';
  group: string;
  enabled: boolean;
  auto: boolean;
  priority: number;
  retainTrigger: boolean;
  recursive: boolean;
  kind: 'literal' | 'regex';
  environment?: string;
  outsideComments?: boolean;
  lineStart?: boolean;
  afterWhitespace?: boolean;
  afterCharacters?: string;
  argument?: string;
}
export interface Stop {
  number: number;
  from: number;
  to: number;
}
export function parseTemplate(template: string) {
  const stops: Stop[] = [];
  let text = '';
  let end = 0;
  const re = /\$\{(\d+)(?::([^}]*))?\}|\$(\d+)/g;
  for (const m of template.matchAll(re)) {
    text += template.slice(end, m.index);
    const from = text.length;
    text += m[2] || '';
    stops.push({ number: Number(m[1] ?? m[3]), from, to: text.length });
    end = m.index! + m[0].length;
  }
  text += template.slice(end);
  if (!stops.some((s) => s.number === 0))
    stops.push({ number: 0, from: text.length, to: text.length });
  stops.sort((a, b) => (a.number || Infinity) - (b.number || Infinity));
  return { text, stops };
}
export function safeRegex(pattern: string) {
  if (pattern.length > 100 || /[+*{]|\\[1-9]|\(\?[=!<]/.test(pattern))
    throw new Error(
      'Regex triggers support bounded, simple patterns only (no repetition, lookarounds, or backreferences).',
    );
  return new RegExp(`(?:${pattern})$`);
}
export function matchSnippet(
  prefix: string,
  context: Context,
  snippets: Snippet[],
  automatic: boolean,
) {
  for (const s of [...snippets].sort(
    (a, b) => b.priority - a.priority || b.trigger.length - a.trigger.length,
  )) {
    if (
      !s.enabled ||
      s.auto !== automatic ||
      !s.trigger ||
      (s.outsideComments !== false && context.comment) ||
      (s.context !== 'everywhere' && s.context !== context.mode) ||
      (s.environment && !context.environments.includes(s.environment)) ||
      (s.argument && context.argument !== s.argument)
    )
      continue;
    let trigger = s.trigger;
    if (s.kind === 'regex') {
      try {
        const m = safeRegex(s.trigger).exec(prefix.slice(-256));
        if (!m || !m[0]) continue;
        trigger = m[0];
      } catch {
        continue;
      }
    } else if (!prefix.endsWith(trigger)) continue;
    const before = prefix.slice(0, -trigger.length);
    if (s.lineStart && before.slice(before.lastIndexOf('\n') + 1).trim()) continue;
    if (s.afterWhitespace && before.length && !/\s$/.test(before)) continue;
    if (s.afterCharacters && !s.afterCharacters.includes(before.at(-1) || '')) continue;
    // Word triggers must not expand inside commands or larger identifiers.
    if (/^[a-zA-Z]+$/.test(trigger) && /[a-zA-Z\\]$/.test(before)) continue;
    const parsed = parseTemplate(s.replacement);
    const retain = s.retainTrigger ? trigger : '';
    return {
      snippet: s,
      from: prefix.length - trigger.length,
      to: prefix.length,
      text: retain + parsed.text,
      stops: parsed.stops.map((p) => ({
        ...p,
        from: p.from + retain.length,
        to: p.to + retain.length,
      })),
    };
  }
  return null;
}
export const defaultSnippets: Snippet[] = [
  ['frac', 'Fraction', 'fr/', '\\frac{${1}}{${2}}$0'],
  ['sqrt', 'Square root', 'sq/', '\\sqrt{${1}}$0'],
  ['alpha', 'Alpha', 'a/', '\\alpha$0'],
  ['beta', 'Beta', 'b/', '\\beta$0'],
  ['sin', 'Sine', 'sin', '\\sin$0'],
  ['sup', 'Superscript', '?', '^{${1}}$0'],
  ['sum', 'Summation', 'sum/', '\\sum_{${1:i=1}}^{${2:n}} ${3}$0'],
  ['int', 'Integral', 'int/', '\\int_{${1:a}}^{${2:b}} ${3}\\,d${4:x}$0'],
  ['bold', 'Bold math', 'bf/', '\\mathbf{${1}}$0'],
  [
    'align',
    'Aligned equations',
    'ali/',
    '\\begin{align}\n  ${1} &= ${2} \\\\\n  ${3} &= ${4}\n\\end{align}$0',
  ],
].map(([id, name, trigger, replacement]) => ({
  id,
  name,
  trigger,
  replacement,
  context: id === 'align' ? 'text' : 'math',
  group: id === 'align' ? 'Environments' : 'Mathematics',
  enabled: true,
  auto: true,
  priority: 0,
  retainTrigger: false,
  recursive: false,
  kind: 'literal',
  outsideComments: true,
}));
