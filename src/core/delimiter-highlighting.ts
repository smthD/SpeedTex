export interface HighlightSettings {
  enabled: boolean;
  mode: 'depth' | 'kind' | 'focus';
  colors: string[];
  activeColor: string;
  errorColor: string;
  activeStyle: 'outline' | 'fill' | 'underline';
  showErrors: boolean;
  highlightScope: boolean;
  environments: boolean;
}
export const delimiterPresets: Record<string, HighlightSettings> = {
  Prism: {
    enabled: true,
    mode: 'depth',
    colors: ['#a9baff', '#e8b488', '#97cfbd', '#d7a6e0', '#e2d38c', '#8fc9e5'],
    activeColor: '#ffffff',
    errorColor: '#f18b9c',
    activeStyle: 'outline',
    showErrors: true,
    highlightScope: false,
    environments: true,
  },
  Blueprint: {
    enabled: true,
    mode: 'kind',
    colors: ['#9dc7ff', '#80e0d3', '#d7b7ff', '#efd398', '#b5c2d6', '#a5d6ef'],
    activeColor: '#b8eaff',
    errorColor: '#ffa08d',
    activeStyle: 'underline',
    showErrors: true,
    highlightScope: false,
    environments: true,
  },
  Focus: {
    enabled: true,
    mode: 'focus',
    colors: ['#aab1bd', '#aab1bd', '#aab1bd', '#aab1bd', '#aab1bd', '#aab1bd'],
    activeColor: '#c6d1ff',
    errorColor: '#dc9b9b',
    activeStyle: 'fill',
    showErrors: true,
    highlightScope: true,
    environments: true,
  },
  Contrast: {
    enabled: true,
    mode: 'depth',
    colors: ['#78e5ff', '#ffcc75', '#d5a5ff', '#a0ef97', '#ff9ebd', '#f2eb94'],
    activeColor: '#ffffff',
    errorColor: '#ff758e',
    activeStyle: 'fill',
    showErrors: true,
    highlightScope: false,
    environments: true,
  },
};
export interface DelimiterToken {
  from: number;
  to: number;
  kind: string;
  depth: number;
  pair?: number;
  error: boolean;
  middle?: boolean;
}
export interface DelimiterPair {
  open: number;
  close: number;
  kind: string;
  depth: number;
}
export interface DelimiterIndex {
  tokens: DelimiterToken[];
  pairs: DelimiterPair[];
}
const named: Record<string, string> = {
  vert: '|',
  Vert: '||',
  '|': '||',
  lbrace: '{',
  rbrace: '}',
  lbrack: '[',
  rbrack: ']',
  lparen: '(',
  rparen: ')',
  langle: '<',
  rangle: '>',
  lvert: '|',
  rvert: '|',
  lVert: '||',
  rVert: '||',
  lceil: 'ceil',
  rceil: 'rceil',
  lfloor: 'floor',
  rfloor: 'rfloor',
};
const closeFor: Record<string, string> = {
  '{': '}',
  '[': ']',
  '(': ')',
  '<': '>',
  ceil: 'rceil',
  floor: 'rfloor',
  '|': '|',
  '||': '||',
};
const leftNames = new Set([
  'lbrace',
  'lbrack',
  'lparen',
  'langle',
  'lvert',
  'lVert',
  'lceil',
  'lfloor',
]);
const rawEnv = /^(?:verbatim|Verbatim|lstlisting|minted|comment)$/;

/** Linear lexical pass. TeX's sized delimiters may intentionally use different
 * shapes (including invisible dots); they pair by sizing command, not glyph. */
export function indexDelimiters(text: string): DelimiterIndex {
  const tokens: DelimiterToken[] = [],
    pairs: DelimiterPair[] = [];
  const stack: { token: number; key: string; close: string }[] = [];
  const buckets = new Map<string, number[]>();
  const signature = (key: string, close: string) => JSON.stringify([key, close]);
  const last = (key: string, close: string) => buckets.get(signature(key, close))?.at(-1);
  const add = (
    from: number,
    to: number,
    kind: string,
    key: string,
    close: string,
    opening: boolean,
  ) => {
    const token: DelimiterToken = { from, to, kind, depth: stack.length, error: false };
    const index = tokens.push(token) - 1;
    const sig = signature(key, close);
    if (opening) {
      const positions = buckets.get(sig) || [];
      positions.push(stack.length);
      buckets.set(sig, positions);
      stack.push({ token: index, key, close });
      return;
    }
    const found = last(key, close) ?? -1;
    if (found < 0) {
      token.error = true;
      return;
    }
    // Never produce crossing matches; recover at the matching enclosing pair.
    for (let n = stack.length - 1; n > found; n--) tokens[stack[n].token].error = true;
    const entry = stack[found];
    for (let n = stack.length - 1; n >= found; n--) {
      const old = stack[n];
      buckets.get(signature(old.key, old.close))!.pop();
    }
    stack.length = found;
    const open = tokens[entry.token];
    token.depth = open.depth;
    const pair = pairs.push({ open: entry.token, close: index, kind, depth: open.depth }) - 1;
    token.pair = pair;
    open.pair = pair;
  };
  let i = 0;
  while (i < text.length) {
    const from = i,
      c = text[i];
    if (c === '%') {
      const end = text.indexOf('\n', i);
      i = end < 0 ? text.length : end;
      continue;
    }
    if (c === '\\') {
      const m = /^\\([A-Za-z]+|[^])/.exec(text.slice(i));
      if (!m) {
        i++;
        continue;
      }
      const command = m[1];
      i += m[0].length;
      if (command === 'verb') {
        if (text[i] === '*') i++;
        const d = text[i++],
          end = text.indexOf(d, i),
          nl = text.indexOf('\n', i);
        i = end < 0 ? (nl < 0 ? text.length : nl) : nl >= 0 && nl < end ? nl : end + 1;
        continue;
      }
      if (command === 'begin' || command === 'end') {
        const arg = /^\s*\{([^}]+)\}/.exec(text.slice(i));
        if (!arg) continue;
        i += arg[0].length;
        const env = arg[1];
        add(from, i, 'environment', 'env:' + env, env, command === 'begin');
        if (command === 'begin' && rawEnv.test(env)) {
          const end = text.indexOf(`\\end{${env}}`, i);
          i = end < 0 ? text.length : end;
        }
        continue;
      }
      if (
        [
          'left',
          'right',
          'middle',
          'bigl',
          'bigr',
          'Bigl',
          'Bigr',
          'biggl',
          'biggr',
          'Biggl',
          'Biggr',
          'big',
          'Big',
          'bigg',
          'Bigg',
        ].includes(command)
      ) {
        const d = /^\s*(\\(?:[A-Za-z]+|[^])|[()[\]{}|.<>/])/.exec(text.slice(i));
        if (!d) {
          tokens.push({ from, to: i, kind: 'sized', depth: stack.length, error: true });
          continue;
        }
        const raw = d[1],
          glyph = raw.startsWith('\\') ? named[raw.slice(1)] || raw.slice(1) : raw;
        i += d[0].length;
        if (command === 'middle') {
          const at = last('left', 'left');
          const parent = at === undefined ? undefined : stack[at];
          tokens.push({
            from,
            to: i,
            kind: 'sized',
            depth: parent ? tokens[parent.token].depth : stack.length,
            error: !parent,
            middle: true,
            pair: parent?.token,
          });
          continue;
        }
        const directional = command === 'left' || command === 'right' || /[lr]$/.test(command);
        const key =
          command === 'left' || command === 'right' ? 'left' : command.replace(/[lr]$/, '');
        if (directional) {
          add(from, i, 'sized', key, key, command === 'left' || command.endsWith('l'));
          continue;
        }
        const opening = ['|', '||'].includes(glyph)
          ? last('glyph', glyph) === undefined
          : Object.hasOwn(closeFor, glyph);
        const closing = Object.values(closeFor).includes(glyph);
        if (opening || closing)
          add(from, i, 'sized', 'glyph', opening ? closeFor[glyph] : glyph, opening);
        continue;
      }
      if (command === '(' || command === '[') {
        add(from, i, 'math', 'math', command === '(' ? ')' : ']', true);
        continue;
      }
      if (command === ')' || command === ']') {
        add(from, i, 'math', 'math', command, false);
        continue;
      }
      if (named[command] || command === '{' || command === '}') {
        const glyph = named[command] || command,
          opening = ['vert', 'Vert', '|'].includes(command)
            ? last('glyph', glyph) === undefined
            : leftNames.has(command) || command === '{';
        add(
          from,
          i,
          'symbol',
          glyph === '{' || glyph === '}' ? 'literal-brace' : 'glyph',
          opening ? closeFor[glyph] : glyph,
          opening,
        );
      }
      continue;
    }
    if (c === '$') {
      const d = text[i + 1] === '$' ? '$$' : '$';
      i += d.length;
      const open = last('dollar', d) === undefined;
      add(from, i, 'math', 'dollar', d, open);
      continue;
    }
    i++;
    if ('({['.includes(c))
      add(
        from,
        i,
        c === '{' ? 'brace' : c === '(' ? 'paren' : 'bracket',
        'glyph',
        closeFor[c],
        true,
      );
    else if (')}]'.includes(c))
      add(from, i, c === '}' ? 'brace' : c === ')' ? 'paren' : 'bracket', 'glyph', c, false);
  }
  for (const entry of stack) tokens[entry.token].error = true;
  for (const token of tokens)
    if (token.middle) {
      const parent = token.pair === undefined ? undefined : tokens[token.pair];
      token.pair = parent?.pair;
      token.error = token.error || token.pair === undefined;
    }
  return { tokens, pairs };
}
export function activeDelimiterPairs(
  index: DelimiterIndex,
  positions: readonly number[],
): Set<number> {
  const active = new Set<number>();
  for (const pos of positions) {
    // A token under the cursor wins; otherwise choose the innermost enclosure.
    const token =
      index.tokens.find((t) => t.from <= pos && pos < t.to) ||
      index.tokens.find((t) => t.to === pos);
    if (token?.pair !== undefined) {
      active.add(token.pair);
      continue;
    }
    let best = -1,
      depth = -1;
    index.pairs.forEach((p, n) => {
      if (index.tokens[p.open].to <= pos && index.tokens[p.close].from >= pos && p.depth > depth) {
        best = n;
        depth = p.depth;
      }
    });
    if (best >= 0) active.add(best);
  }
  return active;
}
