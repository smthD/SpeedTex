export interface SymbolEntry {
  name: string;
  kind: string;
  path: string;
  from: number;
  line: number;
  detail?: string;
  level?: number;
}
export function indexDocument(path: string, text: string): SymbolEntry[] {
  const clean = text.replace(/(?<!\\)%[^\n]*/g, (m) => ' '.repeat(m.length));
  const out: SymbolEntry[] = [];
  const lines = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lines.push(i + 1);
  const lineAt = (pos: number) => {
    let lo = 0,
      hi = lines.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (lines[mid] <= pos) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const add = (name: string, kind: string, from: number, detail?: string, level?: number) =>
    out.push({ name, kind, path, from, line: lineAt(from), detail, level });
  const heading = ['part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph'];
  for (const m of clean.matchAll(
    /\\(part|chapter|section|subsection|subsubsection|paragraph)\*?(?:\[[^\]]*\])?\{/g,
  )) {
    let depth = 1,
      end = m.index! + m[0].length;
    const start = end;
    for (; end < clean.length; end++) {
      if (clean[end] === '\\') {
        end++;
        continue;
      }
      if (clean[end] === '{') depth++;
      if (clean[end] === '}' && !--depth) break;
    }
    add(clean.slice(start, end), 'section', m.index!, m[1], heading.indexOf(m[1]));
  }
  for (const m of clean.matchAll(/\\label\{([^}]+)\}/g)) add(m[1], 'label', m.index!);
  for (const m of clean.matchAll(
    /\\(?:newcommand|renewcommand|providecommand|DeclareMathOperator)\*?\s*\{?\\([a-zA-Z@]+)/g,
  ))
    add('\\' + m[1], 'command', m.index!);
  for (const m of clean.matchAll(/\\(?:newenvironment|renewenvironment)\{([^}]+)\}/g))
    add(m[1], 'environment', m.index!);
  for (const m of clean.matchAll(
    /\\begin\{(theorem|definition|figure|table|equation|align)\*?\}(?:\[([^\]]+)\])?/g,
  ))
    add(m[2] || m[1], m[1], m.index!);
  if (path.endsWith('.bib'))
    for (const m of text.matchAll(/@(\w+)\s*\{\s*([^,]+),/g)) {
      const from = m.index!;
      const next = text.indexOf('\n@', from + 1);
      const body = text.slice(from, next < 0 ? text.length : next);
      const field = (f: string) =>
        new RegExp(f + '\\s*=\\s*[{\"]([^}\"]+)', 'i').exec(body)?.[1] || '';
      add(
        m[2].trim(),
        'citation',
        from,
        [field('author'), field('title'), field('year')].filter(Boolean).join(' · '),
      );
    }
  return out;
}
export function fuzzy(query: string, value: string) {
  query = query.toLowerCase();
  value = value.toLowerCase();
  let pos = 0,
    score = 0;
  for (const c of query) {
    const at = value.indexOf(c, pos);
    if (at < 0) return -1;
    score += at === pos ? 10 : 1;
    pos = at + 1;
  }
  return score + (value.startsWith(query) ? 30 : 0) - value.length * 0.01;
}
