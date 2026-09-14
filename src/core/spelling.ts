export interface SpellingIssue {
  from: number;
  to: number;
  word: string;
}
export const wordKey = (word: string) => word.replaceAll('’', "'").toLowerCase();
export function dictionaryWords(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 10000 ||
    value.some((w) => typeof w !== 'string' || !/^[\p{L}][\p{L}'’\-]{0,79}$/u.test(w))
  )
    throw new Error('Dictionary must contain up to 10,000 words, at most 80 letters each.');
  return [...new Set(value.map(wordKey))];
}
const mathEnvironment =
  /^(?:equation|align|alignat|gather|multline|flalign|displaymath|math|eqnarray|matrix|pmatrix|bmatrix|vmatrix|Vmatrix|cases|split)\*?$/;
const rawEnvironment = /^(?:verbatim|Verbatim|lstlisting|minted|comment)$/;
const textCommand = /^(?:text|textrm|textnormal|textbf|textit|textsf|texttt|mbox|intertext)$/;
const skipArguments: Record<string, number> = {
  label: 1,
  ref: 1,
  eqref: 1,
  autoref: 1,
  pageref: 1,
  cref: 1,
  Cref: 1,
  vref: 1,
  cite: 1,
  citep: 1,
  citet: 1,
  autocite: 1,
  parencite: 1,
  textcite: 1,
  nocite: 1,
  url: 1,
  path: 1,
  href: 1,
  includegraphics: 1,
  input: 1,
  include: 1,
  usepackage: 1,
  RequirePackage: 1,
  documentclass: 1,
  bibliographystyle: 1,
  bibliography: 1,
  addbibresource: 1,
  newcommand: 2,
  renewcommand: 2,
  providecommand: 2,
  DeclareMathOperator: 2,
  newenvironment: 3,
  renewenvironment: 3,
  setlength: 2,
  addtolength: 2,
  newtheorem: 2,
  color: 1,
  textcolor: 1,
};

/** Single forward scan; offsets remain UTF-16 offsets for CodeMirror. Unknown
 * macros are skipped by name, while their prose arguments remain checkable. */
export function proseWords(text: string, comments = false): SpellingIssue[] {
  const out: SpellingIssue[] = [];
  let i = 0,
    math: string | null = null;
  const environments: string[] = [];
  const braces: boolean[] = [];
  let forceText = false;
  const words = /\p{L}+(?:['’]\p{L}+)*/uy;
  const emit = (end: number) => {
    words.lastIndex = i;
    const m = words.exec(text);
    if (!m) return false;
    const word = m[0];
    i += word.length;
    if (i <= end && word.length > 1 && word.length <= 80 && !/^\p{Lu}+$/u.test(word))
      out.push({ from: i - word.length, to: i, word });
    return true;
  };
  const space = () => {
    while (/\s/.test(text[i] || '') && i < text.length) i++;
  };
  const group = (open: string, close: string) => {
    if (text[i] !== open) return;
    let depth = 0;
    do {
      const c = text[i++];
      if (c === '\\') i = Math.min(text.length, i + 1);
      else if (c === open) depth++;
      else if (c === close) depth--;
    } while (depth && i < text.length);
  };
  while (i < text.length) {
    const c = text[i];
    if (c === '%') {
      const end = text.indexOf('\n', i);
      const stop = end < 0 ? text.length : end;
      if (comments) {
        i++;
        while (i < stop) if (!emit(stop)) i++;
      }
      i = stop;
      continue;
    }
    if (c === '\\') {
      const command = /^\\([A-Za-z@]+|[^])/u.exec(text.slice(i));
      if (!command) {
        i++;
        continue;
      }
      const name = command[1];
      i += command[0].length;
      if (name === '(' || name === '[') {
        math = name;
        continue;
      }
      if (name === ')' || name === ']') {
        math = null;
        continue;
      }
      if (name === 'verb') {
        if (text[i] === '*') i++;
        const delimiter = text[i++];
        const end = text.indexOf(delimiter, i);
        i = end < 0 ? text.length : end + 1;
        continue;
      }
      if (text[i] === '*') i++;
      if (name === 'begin' || name === 'end') {
        space();
        const start = i;
        group('{', '}');
        const env = text.slice(start + 1, i - 1);
        if (name === 'begin' && rawEnvironment.test(env)) {
          const end = text.indexOf(`\\end{${env}}`, i);
          i = end < 0 ? text.length : end + env.length + 6;
        } else if (name === 'begin') {
          environments.push(env);
          space();
          if (text[i] === '[') group('[', ']');
        } else {
          const at = environments.lastIndexOf(env);
          if (at >= 0) environments.splice(at);
        }
        continue;
      }
      const count = skipArguments[name] ?? (/^(?:cite|ref)[A-Za-z]*$/.test(name) ? 1 : 0);
      if (count) {
        for (let n = 0; n < count; n++) {
          space();
          while (text[i] === '[') {
            group('[', ']');
            space();
          }
          if (text[i] === '{') group('{', '}');
          else if (text[i] === '\\') {
            const m = /^\\[A-Za-z@]+/.exec(text.slice(i));
            if (m) i += m[0].length;
          }
        }
        continue;
      }
      if (textCommand.test(name)) {
        space();
        if (text[i] === '{') {
          braces.push(forceText);
          forceText = true;
          i++;
        }
      }
      continue;
    }
    if (c === '$') {
      const delimiter = text[i + 1] === '$' ? '$$' : '$';
      math = math === delimiter ? null : math || delimiter;
      i += delimiter.length;
      continue;
    }
    if (c === '{') {
      braces.push(forceText);
      i++;
      continue;
    }
    if (c === '}') {
      forceText = braces.pop() ?? false;
      i++;
      continue;
    }
    if (!forceText && (math || environments.some((e) => mathEnvironment.test(e)))) {
      i++;
      continue;
    }
    const url = /^(?:https?:\/\/|www\.)[^\s{}]+|^[\w.+-]+@[\w.-]+\.[a-zA-Z]+/.exec(text.slice(i));
    if (url) {
      i += url[0].length;
      continue;
    }
    if (!emit(text.length)) i++;
  }
  return out;
}
