export interface DelimiterEdit {
  from: number;
  to: number;
  insert: string;
  anchor: number;
  head?: number;
}
export function delimiterInput(
  text: string,
  from: number,
  to: number,
  typed: string,
): DelimiterEdit | null {
  if (typed.length !== 1) return null;
  const selected = text.slice(from, to),
    before = text.slice(0, from),
    next = text.slice(to);
  const close: Record<string, string> = { '(': ')', '[': ']', '{': '}', $: '$' };
  // A second dollar changes an empty inline pair into an empty display pair.
  if (
    typed === '$' &&
    from === to &&
    before.endsWith('$') &&
    !before.endsWith('$$') &&
    next.startsWith('$') &&
    !next.startsWith('$$')
  )
    return { from: from - 1, to: to + 1, insert: '$$$$', anchor: from + 1 };
  const left = /\\left(\\?)$/.exec(before);
  if (left && close[typed] && typed !== '$') {
    const end = '\\right' + left[1] + close[typed];
    return {
      from,
      to,
      insert: typed + selected + end,
      anchor: from + 1,
      head: from + 1 + selected.length,
    };
  }
  if (before.endsWith('\\') && ['(', '['].includes(typed))
    return {
      from,
      to,
      insert: typed + selected + '\\' + close[typed],
      anchor: from + 1,
      head: from + 1 + selected.length,
    };
  if (from === to && [')', ']', '}', '$'].includes(typed) && next.startsWith(typed))
    return { from, to, insert: '', anchor: to + 1 };
  if (close[typed] && !before.endsWith('\\'))
    return {
      from,
      to,
      insert: typed + selected + close[typed],
      anchor: from + 1,
      head: from + 1 + selected.length,
    };
  return null;
}
export function delimiterBackspace(text: string, pos: number): DelimiterEdit | null {
  if (pos < 1) return null;
  const before = text.slice(0, pos),
    after = text.slice(pos);
  if (before.endsWith('$$') && after.startsWith('$$'))
    return { from: pos - 2, to: pos + 2, insert: '', anchor: pos - 2 };
  for (const [a, b] of [
    ['\\left(', '\\right)'],
    ['\\left[', '\\right]'],
    ['\\left\\{', '\\right\\}'],
    ['\\(', '\\)'],
    ['\\[', '\\]'],
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
    ['$', '$'],
  ])
    if (before.endsWith(a) && after.startsWith(b))
      return { from: pos - a.length, to: pos + b.length, insert: '', anchor: pos - a.length };
  return null;
}
