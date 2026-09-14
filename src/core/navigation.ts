import { termRanges, type TermRules } from './terms.ts';
export { termRanges } from './terms.ts';
export interface Pair {
  open: number;
  close: number;
  char: string;
  width: number;
  closeWidth: number;
}
export function pairs(text: string): Pair[] {
  const result: Pair[] = [];
  const stack: { open: number; char: string; width: number }[] = [];
  let comment = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\n') {
      comment = false;
      continue;
    }
    if (comment) continue;
    if (c === '%') {
      comment = true;
      continue;
    }
    if (c === '\\') {
      const n = text[i + 1];
      if (n === '(' || n === '[') {
        stack.push({ open: i, char: '\\' + n, width: 2 });
        i++;
        continue;
      }
      if (n === ')' || n === ']') {
        const idx = stack.map((p) => p.char).lastIndexOf(n === ')' ? '\\(' : '\\[');
        if (idx >= 0) {
          const [p] = stack.splice(idx, 1);
          result.push({ ...p, close: i, closeWidth: 2 });
        }
        i++;
        continue;
      }
      if (n && !/[A-Za-z]/.test(n)) {
        i++;
        continue;
      }
    }
    if ('({['.includes(c)) {
      stack.push({ open: i, char: c, width: 1 });
      continue;
    }
    if (')}]'.includes(c)) {
      const char = '({['[')}]'.indexOf(c)];
      const idx = stack.map((p) => p.char).lastIndexOf(char);
      if (idx >= 0) {
        const [p] = stack.splice(idx, 1);
        result.push({ ...p, close: i, closeWidth: 1 });
      }
    }
    if (c === '$') {
      const d = text[i + 1] === '$' ? '$$' : '$';
      const idx = stack.map((p) => p.char).lastIndexOf(d);
      if (idx >= 0) {
        const [p] = stack.splice(idx, 1);
        result.push({ ...p, close: i, closeWidth: d.length });
      } else stack.push({ open: i, char: d, width: d.length });
      if (d === '$$') i++;
    }
  }
  return result.sort((a, b) => a.open - b.open);
}
export type Movement =
  | 'nextTerm'
  | 'previousTerm'
  | 'lineStart'
  | 'lineEnd'
  | 'nextPosition'
  | 'previousPosition'
  | 'nextArgument'
  | 'previousArgument'
  | 'outside'
  | 'inside'
  | 'matching'
  | 'nextCommand'
  | 'previousCommand'
  | 'nextEnvironment'
  | 'mathStart'
  | 'mathEnd'
  | 'nextMath'
  | 'previousMath';
export function navigate(text: string, pos: number, action: Movement, rules?: TermRules): number {
  pos = Math.min(text.length, Math.max(0, pos));
  if (action === 'lineStart') return pos === 0 ? 0 : text.lastIndexOf('\n', pos - 1) + 1;
  if (action === 'lineEnd') {
    const newline = text.indexOf('\n', pos);
    const end = newline < 0 ? text.length : newline;
    return end > 0 && text[end - 1] === '\r' ? Math.max(pos, end - 1) : end;
  }
  if (action === 'nextTerm' || action === 'previousTerm') {
    const terms = termRanges(text, rules, true);
    if (action === 'nextTerm') return terms.find((t) => t.to > pos)?.to ?? text.length;
    return terms.filter((t) => t.from < pos).at(-1)?.from ?? 0;
  }
  const ps = pairs(text);
  const containing = ps
    .filter((p) => p.open < pos && p.close >= pos)
    .sort((a, b) => b.open - a.open);
  const brace = containing.find((p) => p.char === '{');
  if (action === 'previousPosition') {
    const braces = ps.filter((p) => p.char === '{');
    const openings = new Set(braces.map((p) => p.open));
    let previous = -1;
    const visit = (stop: number) => {
      // From within an argument, go back to the preceding structural stop,
      // rather than merely resetting the cursor to this argument's beginning.
      if (stop < pos && stop !== (brace ? brace.open + 1 : -1)) previous = Math.max(previous, stop);
    };
    for (const p of braces) {
      visit(p.open + 1);
      let following = p.close + 1;
      while (following < text.length && /\s/.test(text[following])) following++;
      // Forward movement skips the boundary between adjacent arguments; so
      // does backward movement. This makes the logical stops reversible.
      if (!openings.has(following)) visit(p.close + 1);
    }
    return previous >= 0 ? previous : brace ? brace.open + 1 : pos;
  }
  if (action === 'nextPosition') {
    // Visit children before leaving their parent argument. Unlike nextArgument,
    // this command walks into nested expressions rather than skipping them.
    const next = ps.find((p) => p.char === '{' && p.open >= pos);
    if (next && (!brace || next.open < brace.close)) return next.open + 1;
    if (brace) {
      // Adjacent arguments are one logical step, including whitespace between them.
      if (next && /^\s*$/.test(text.slice(brace.close + 1, next.open))) return next.open + 1;
      return brace.close + 1;
    }
    return pos;
  }
  if (action === 'outside') return brace ? brace.close + 1 : pos;
  if (action === 'inside')
    return brace
      ? brace.open + 1
      : ps.find((p) => p.open >= pos && p.char === '{')?.open! + 1 || pos;
  if (action === 'matching') {
    const p = ps.find((p) => p.open === pos || p.open + p.width === pos || p.close === pos);
    return p ? (pos === p.close ? p.open : p.close) : pos;
  }
  if (action === 'nextArgument' || action === 'previousArgument') {
    // Only root-level brace pairs are stops, even when the cursor is deep
    // inside a superscript or a nested command in the current argument.
    const roots: Pair[] = [];
    for (const p of ps)
      if (p.char === '{' && (!roots.length || p.open > roots.at(-1)!.close)) roots.push(p);
    const current = roots.find((p) => p.open < pos && pos <= p.close);
    if (action === 'nextArgument') {
      const next = roots.find((p) => p.open >= (current ? current.close + 1 : pos));
      return next ? next.open + 1 : current ? current.close + 1 : pos;
    }
    const before = roots.filter((p) => p.close < (current ? current.open : pos)).at(-1);
    return before ? before.open + 1 : current ? current.open + 1 : pos;
  }
  if (action === 'nextCommand' || action === 'previousCommand' || action === 'nextEnvironment') {
    const re = action === 'nextEnvironment' ? /\\begin\{[^}]+\}/g : /\\[a-zA-Z]+/g;
    const positions = [
      ...text.replace(/(?<!\\)%[^\n]*/g, (m) => ' '.repeat(m.length)).matchAll(re),
    ].map((m) => m.index!);
    return action === 'previousCommand'
      ? (positions.filter((p) => p < pos).at(-1) ?? pos)
      : (positions.find((p) => p > pos) ?? pos);
  }
  const maths = ps.filter((p) => ['$', '$$', '\\(', '\\['].includes(p.char));
  const current = maths.find((p) => p.open < pos && p.close >= pos);
  if (action === 'mathStart') return current ? current.open + current.width : pos;
  if (action === 'mathEnd') return current?.close ?? pos;
  if (action === 'nextMath') {
    const p = maths.find((p) => p.open >= pos);
    return p ? p.open + p.width : pos;
  }
  if (action === 'previousMath') {
    const p = maths.filter((p) => p.open < pos).at(-1);
    return p ? p.open + p.width : pos;
  }
  return pos;
}
