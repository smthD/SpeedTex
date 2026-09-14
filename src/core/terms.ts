export interface TermRules {
  termSeparators: string[];
  termWhitespace: boolean;
}
export const defaultTermRules: TermRules = {
  termWhitespace: true,
  termSeparators: [
    '+',
    '-',
    '\\cdot',
    '\\times',
    '$',
    '$$',
    '\\(',
    '\\)',
    '\\[',
    '\\]',
    '(',
    ')',
    '[',
    ']',
    '\\left(',
    '\\right)',
    '\\left[',
    '\\right]',
    '\\left)',
    '\\right(',
    '\\left]',
    '\\right[',
  ],
};

// Keep commands/escapes indivisible. Sizing commands and their round/square
// delimiter form one token, including optional whitespace (e.g. \left [).
function tokens(text: string) {
  return [...text.matchAll(/\\(?:left|right)\s*[()[\]]|\\[A-Za-z]+|\\[^]|\$\$|[^]/g)];
}
const spelling = (text: string) => text.replace(/^(\\(?:left|right))\s+/, '$1');

/** Boundaries are literal token sequences, never regular expressions. Matching
 * Navigation includes each separator as its own step; selection/cutting use
 * only the expression ranges. Matching only complete tokens protects \timesfoo, \$ and escaped punctuation. */
export function termRanges(
  text: string,
  rules: TermRules = defaultTermRules,
  includeSeparators = false,
): { from: number; to: number }[] {
  const separators = rules.termSeparators
    .map((s) => tokens(s).map((t) => spelling(t[0])))
    .filter((s) => s.length)
    .sort((a, b) => b.length - a.length);
  const input = tokens(text);
  const result: { from: number; to: number }[] = [];
  let start = -1;
  for (let i = 0; i < input.length;) {
    const token = input[i];
    const count =
      rules.termWhitespace && /^\s$/.test(token[0])
        ? 1
        : separators.find((s) =>
            s.every((part, offset) => input[i + offset] && spelling(input[i + offset][0]) === part),
          )?.length || 0;
    if (count) {
      if (start >= 0) result.push({ from: start, to: token.index! });
      start = -1;
      if (includeSeparators) {
        const last = input[i + count - 1];
        result.push({ from: token.index!, to: last.index! + last[0].length });
      }
      i += count;
    } else {
      if (start < 0) start = token.index!;
      i++;
    }
  }
  if (start >= 0) result.push({ from: start, to: text.length });
  return result;
}
