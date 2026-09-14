export type Mode = 'math' | 'text';
export interface Context {
  mode: Mode;
  comment: boolean;
  environments: string[];
  argument: string | null;
}
interface State {
  math: string | null;
  environments: string[];
  braces: (string | null)[];
  comment: boolean;
}
const mathEnvs =
  /^(?:equation|align|alignat|gather|multline|flalign|displaymath|math|eqnarray|matrix|pmatrix|bmatrix|vmatrix|Vmatrix|cases|split)\*?$/;
function initial(): State {
  return { math: null, environments: [], braces: [], comment: false };
}
function clone(s: State): State {
  return { ...s, environments: [...s.environments], braces: [...s.braces] };
}
function scan(text: string, start: number, end: number, s: State) {
  for (let i = start; i < end; i++) {
    const c = text[i];
    if (c === '\n') {
      s.comment = false;
      continue;
    }
    if (s.comment) continue;
    if (c === '%') {
      s.comment = true;
      continue;
    }
    if (c === '\\') {
      const next = text[i + 1];
      if (next === '(' || next === '[') {
        s.math = next === '(' ? '\\(' : '\\[';
        i++;
        continue;
      }
      if (next === ')' || next === ']') {
        if (s.math === (next === ')' ? '\\(' : '\\[')) s.math = null;
        i++;
        continue;
      }
      if (next && !/[a-zA-Z@]/.test(next)) {
        i++;
        continue;
      }
      const m = /^\\(begin|end)\{([^}]+)\}/.exec(text.slice(i, Math.min(text.length, i + 160)));
      if (m && i + m[0].length <= end) {
        if (m[1] === 'begin') s.environments.push(m[2]);
        else {
          const n = s.environments.lastIndexOf(m[2]);
          if (n >= 0) s.environments.splice(n);
        }
        i += m[0].length - 1;
        continue;
      }
    }
    if (c === '$') {
      const d = text[i + 1] === '$' && i + 1 < end ? '$$' : '$';
      s.math = s.math === d ? null : s.math || d;
      if (d === '$$') i++;
    }
    if (c === '{') {
      const prefix = text.slice(Math.max(0, i - 200), i);
      const m = /\\([a-zA-Z@]+)\*?(?:\[[^\]]*\])?$/.exec(prefix);
      s.braces.push(m?.[1] || s.braces.at(-1) || null);
    }
    if (c === '}') s.braces.pop();
  }
}
export class ContextIndex {
  private text = '';
  private checkpoints = new Map<number, State>([[0, initial()]]);
  update(text: string, changedFrom = 0) {
    this.text = text;
    const line = text.lastIndexOf('\n', Math.max(0, changedFrom - 1)) + 1;
    for (const p of this.checkpoints.keys()) if (p >= line && p !== 0) this.checkpoints.delete(p);
  }
  at(pos: number): Context {
    pos = Math.max(0, Math.min(pos, this.text.length));
    let start = 0;
    for (const p of this.checkpoints.keys()) if (p <= pos && p > start) start = p;
    const s = clone(this.checkpoints.get(start)!);
    while (start < pos) {
      const nl = this.text.indexOf('\n', start);
      const end = nl >= 0 && nl < pos ? nl + 1 : pos;
      scan(this.text, start, end, s);
      start = end;
      if (nl >= 0 && end === nl + 1) this.checkpoints.set(end, clone(s));
    }
    const textArgument = s.braces.some(
      (x) => x !== null && /^(text|textrm|textnormal|textbf|textit|mbox|intertext)$/.test(x),
    );
    return {
      mode:
        !textArgument && (s.math || s.environments.some((e) => mathEnvs.test(e))) ? 'math' : 'text',
      comment: s.comment,
      environments: [...s.environments],
      argument: s.braces.at(-1) || null,
    };
  }
}
export function contextAt(text: string, pos: number) {
  const i = new ContextIndex();
  i.update(text);
  return i.at(pos);
}
