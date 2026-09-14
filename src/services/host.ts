import type { Config, Settings } from '../core/config';
export interface Entry {
  path: string;
  directory: boolean;
}
export interface Project {
  name: string;
  root: string;
  entries: Entry[];
}
export interface Recovery {
  root: string;
  path: string;
  text: string;
  version: string | null;
}
export interface LiveRequest {
  rootFile: string;
  compiler: string;
  engine: string;
  mode: 'accurate' | 'fast';
  buffers: { path: string; text: string }[];
}
export interface LiveResult {
  ok: boolean;
  code: number | null;
  pdf?: Uint8Array;
  syncId?: string | null;
  log: string;
  metrics: { syncMs: number; compileMs: number; totalMs?: number };
}
export interface Host {
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  openProject(): Promise<Project | null>;
  recent(): Promise<string[]>;
  openRecent(path: string): Promise<Project | null>;
  list(): Promise<Entry[]>;
  read(path: string): Promise<{ text: string; version: string }>;
  write(path: string, text: string, version: string | null): Promise<{ version: string }>;
  create(path: string, directory: boolean): Promise<Entry[]>;
  rename(a: string, b: string): Promise<Entry[]>;
  trash(path: string): Promise<Entry[]>;
  loadDictionaries(): Promise<{ global: string[]; project: string[] }>;
  saveDictionary(words: string[], scope: 'global' | 'project'): Promise<void>;
  loadConfig(): Promise<{ global: Config | null; project: Config | null }>;
  saveConfig(c: Config, scope: string): Promise<void>;
  loadRecovery(): Promise<Recovery[]>;
  saveRecovery(records: Recovery[]): Promise<void>;
  build(s: Settings): Promise<unknown>;
  liveBuild(request: LiveRequest): Promise<LiveResult>;
  cancelLive(): Promise<void>;
  cancelBuild(): Promise<void>;
  readPreview(p: string): Promise<{ pdf: Uint8Array; syncId: string | null }>;
  retainSync(id: string | null): Promise<void>;
  syncForward(
    id: string,
    file: string,
    line: number,
    column: number,
    text: string,
  ): Promise<{ page: number; x: number; y: number }>;
  syncInverse(
    id: string,
    page: number,
    x: number,
    y: number,
  ): Promise<{ file: string; line: number; column: number; hash: string }>;
  focusEditor(): Promise<void>;
  readPdf(p: string): Promise<Uint8Array>;
  onChange(cb: (p: string) => void): () => void;
  onBuildOutput(cb: (s: string) => void): () => void;
  onBuildDone(cb: (s: { code: number }) => void): () => void;
  onClosing(cb: () => void): () => void;
  close(): Promise<void>;
}
declare global {
  interface Window {
    quill?: Host;
  }
}
export const demoFiles: Record<string, string> = {
  'main.tex': String.raw`\documentclass[11pt]{article}
\usepackage{amsmath, amssymb, amsthm}
\usepackage[margin=1in]{geometry}
\usepackage{hyperref}

\newcommand{\R}{\mathbb{R}}
\newtheorem{theorem}{Theorem}

\title{Notes on mathematical analysis}
\author{A working notebook}
\date{\today}

\begin{document}
\maketitle

\section{Introduction}
These notes explore the connections between continuity,
differentiation, and integration. We begin with a familiar
idea: understanding a function through its local behavior.

\section{Limits and continuity}
\label{sec:limits}
Let $f : \R \to \R$. We say that $f$ is continuous at $a$
if, for every $\varepsilon > 0$, there exists $\delta > 0$ such that
\begin{equation}
  |x-a| < \delta \implies |f(x)-f(a)| < \varepsilon.
  \label{eq:continuity}
\end{equation}

\subsection{A useful example}
Consider the following expression:
\[
  f(x) = \frac{\sin^2(\alpha)}{\sqrt{x^2+1}}
\]
% Try typing fr/ or sq/ inside the math expression below.
\[
  x = 0
\]

\section{The fundamental theorem}
\begin{theorem}
If $f$ is continuous on $[a,b]$, then
\[
  \frac{d}{dx}\int_a^x f(t)\,dt = f(x).
\]
\end{theorem}

\input{sections/remarks}
\bibliographystyle{plain}
\bibliography{references}
\end{document}
`,
  'sections/remarks.tex': String.raw`\section{Further remarks}
\label{sec:remarks}
The continuity condition in Section~\ref{sec:limits} is essential.
For a more detailed treatment, see \cite{rudin1976}.

\subsection{Next steps}
Explore uniform convergence and the interchange of limits.
`,
  'references.bib': String.raw`@book{rudin1976,
  author = {Walter Rudin},
  title = {Principles of Mathematical Analysis},
  year = {1976},
  publisher = {McGraw-Hill}
}
`,
  'README.md':
    '# Mathematical analysis\n\nA small LaTeX project. Compile main.tex using latexmk.\n',
};
function stored<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}
let files: Record<string, string> = stored('quill.demo.files', demoFiles);
let dirs = new Set(['sections']);
const entries = () => [
  ...Array.from(dirs).map((path) => ({ path, directory: true })),
  ...Object.keys(files).map((path) => ({ path, directory: false })),
];
const persist = () => localStorage.setItem('quill.demo.files', JSON.stringify(files));
const unavailable = async () => {
  throw Error('Open the desktop application to compile local LaTeX projects.');
};
export const native = !!window.quill;
export const host: Host = window.quill || {
  readClipboard: () => navigator.clipboard.readText(),
  writeClipboard: (text) => navigator.clipboard.writeText(text),
  openProject: async () => ({ name: 'Mathematical analysis', root: 'demo', entries: entries() }),
  recent: async () => [],
  openRecent: async () => null,
  list: async () => entries(),
  read: async (p) => {
    if (!(p in files)) throw Error('File not found');
    return { text: files[p], version: files[p] };
  },
  write: async (p, text, version) => {
    if ((files[p] ?? null) !== version) throw Error('CONFLICT: File changed. Reload first.');
    files[p] = text;
    persist();
    return { version: text };
  },
  create: async (p, directory) => {
    if (p in files || dirs.has(p)) throw Error('Already exists');
    if (directory) dirs.add(p);
    else files[p] = '';
    persist();
    return entries();
  },
  rename: async (a, b) => {
    if (b in files || dirs.has(b)) throw Error('Already exists');
    for (const p of Object.keys(files))
      if (p === a || p.startsWith(a + '/')) {
        files[b + p.slice(a.length)] = files[p];
        delete files[p];
      }
    if (dirs.has(a)) {
      dirs.delete(a);
      dirs.add(b);
    }
    persist();
    return entries();
  },
  trash: async (p) => {
    for (const name of Object.keys(files))
      if (name === p || name.startsWith(p + '/')) delete files[name];
    dirs.delete(p);
    persist();
    return entries();
  },
  loadDictionaries: async () => ({
    global: stored('quill.dictionary.global', []),
    project: stored('quill.dictionary.project', []),
  }),
  saveDictionary: async (words, scope) => {
    localStorage.setItem('quill.dictionary.' + scope, JSON.stringify(words));
  },
  loadConfig: async () => ({ global: stored('quill.config', null), project: null }),
  saveConfig: async (c) => {
    localStorage.setItem('quill.config', JSON.stringify(c));
  },
  loadRecovery: async () => stored('quill.recovery', []),
  saveRecovery: async (r) => {
    localStorage.setItem('quill.recovery', JSON.stringify(r));
  },
  build: unavailable,
  liveBuild: unavailable,
  cancelLive: async () => {},
  cancelBuild: async () => {},
  readPdf: unavailable,
  readPreview: unavailable,
  retainSync: async () => {},
  syncForward: unavailable,
  syncInverse: unavailable,
  focusEditor: async () => {},
  onChange: () => () => {},
  onBuildOutput: () => () => {},
  onBuildDone: () => () => {},
  onClosing: () => () => {},
  close: async () => {},
};
