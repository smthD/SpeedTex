import type { TermRules } from './terms.ts';
import { pairs, termRanges } from './navigation.ts';
export interface TextRange {
  from: number;
  to: number;
}
/** Select a containing term, preferring the left term when on a separator. */
export function selectTermLeft(text: string, range: TextRange, rules?: TermRules): TextRange {
  const terms = termRanges(text, rules);
  if (range.from !== range.to) {
    const left = terms.filter((t) => t.from < range.from).at(-1);
    return left ? { from: left.from, to: range.to } : range;
  }
  return (
    terms.find((t) => t.from <= range.from && range.from < t.to) ??
    terms.filter((t) => t.to <= range.from).at(-1) ??
    terms[0] ??
    range
  );
}
/** Delete back to the preceding term start, including intervening separators. */
export function leftTermCut(text: string, pos: number, rules?: TermRules): TextRange {
  return {
    from:
      termRanges(text, rules)
        .filter((t) => t.from < pos)
        .at(-1)?.from ?? pos,
    to: pos,
  };
}
export function braceContent(text: string, pos: number): TextRange | null {
  const brace = pairs(text)
    .filter((p) => p.char === '{' && p.open < pos && pos <= p.close)
    .at(-1);
  return brace ? { from: brace.open + 1, to: brace.close } : null;
}
export function mergeRanges(ranges: TextRange[]): TextRange[] {
  const result: TextRange[] = [];
  for (const r of ranges.filter((r) => r.from < r.to).sort((a, b) => a.from - b.from)) {
    const last = result.at(-1);
    if (last && r.from <= last.to) last.to = Math.max(last.to, r.to);
    else result.push({ ...r });
  }
  return result;
}
