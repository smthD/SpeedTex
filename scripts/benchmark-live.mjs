import { mkdtemp, cp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir, cpus, platform, arch } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
const temp = await mkdtemp(path.join(tmpdir(), 'quill-live-bench-'));
const invoke = (program, args, cwd) =>
  new Promise((resolve, reject) => {
    const start = performance.now();
    const p = spawn(program, args, { cwd });
    let log = '';
    p.stdout.on('data', (b) => {
      log = (log + b).slice(-1500);
    });
    p.stderr.on('data', (b) => {
      log = (log + b).slice(-1500);
    });
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0
        ? resolve({ ms: performance.now() - start, log })
        : reject(Error(`${program}: ${code}\n${log}`)),
    );
  });
const args = ['-interaction=nonstopmode', '-file-line-error', '-halt-on-error', '-no-shell-escape'];
const mathBody = Array.from(
  { length: 30 },
  (_, i) =>
    String.raw`\section{Analysis ${i + 1}}Version: \iteration. For a continuous function, consider\[f(x)=\frac{\sin^2(\alpha)}{\sqrt{x^2+1}}+\sum_{n=1}^{\infty}\frac{x^n}{n!}.\]` +
    '\nA paragraph about mathematical analysis, convergence and continuity. $a^2+b^2=c^2$.\\par\n'.repeat(
      10,
    ) +
    (i < 29 ? '\\newpage' : ''),
).join('\n');
const tikz = Array.from(
  { length: 5 },
  () =>
    String.raw`\begin{tikzpicture}\foreach \n in {1,...,12}{\draw plot[domain=0:6,samples=100] (\x,{sin(\n*\x r)/\n});}\end{tikzpicture}\newpage`,
).join('\n');
const cases = [
  { name: 'sample-notes', sample: true },
  { name: 'math-30-pages', body: mathBody },
  { name: 'tikz-5-pages', body: tikz, packages: '\\usepackage{tikz}' },
];
const results = [];
try {
  for (const c of cases) {
    for (const engine of ['latexmk', 'pdflatex']) {
      const dir = path.join(temp, c.name + '-' + engine);
      await mkdir(dir);
      let source;
      if (c.sample) {
        await cp('examples/math-notes', dir, { recursive: true });
        source = (await readFile(path.join(dir, 'main.tex'), 'utf8')).replace(
          '\\begin{document}',
          '\\newcommand{\\iteration}{0}\n\\begin{document}\nVersion: \\iteration.',
        );
      } else
        source =
          String.raw`\documentclass{article}\usepackage{amsmath,amssymb}\usepackage[margin=1in]{geometry}` +
          (c.packages || '') +
          String.raw`\newcommand{\iteration}{0}\begin{document}` +
          c.body +
          String.raw`\end{document}`;
      await writeFile(path.join(dir, 'main.tex'), source);
      const cmdArgs =
        engine === 'latexmk' ? ['-norc', '-pdf', ...args, 'main.tex'] : [...args, 'main.tex'];
      const cold = await invoke(engine, cmdArgs, dir);
      // Fully resolve references/citations before timing warm single-pass edits.
      if (engine === 'pdflatex')
        await invoke('latexmk', ['-norc', '-pdf', ...args, 'main.tex'], dir);
      const warm = [];
      for (let i = 1; i <= 7; i++) {
        await writeFile(
          path.join(dir, 'main.tex'),
          source.replace('{\\iteration}{0}', `{\\iteration}{${i}}`),
        );
        warm.push((await invoke(engine, cmdArgs, dir)).ms);
      }
      const sorted = [...warm].sort((a, b) => a - b);
      const row = {
        case: c.name,
        engine,
        coldMs: Math.round(cold.ms),
        warmMs: warm.map(Math.round),
        medianMs: Math.round(sorted[3]),
        maxMs: Math.round(sorted.at(-1)),
      };
      results.push(row);
      console.log(JSON.stringify(row));
    }
  }
  await writeFile(
    'research/compile-benchmark.json',
    JSON.stringify(
      {
        date: new Date().toISOString(),
        machine: { cpu: cpus()[0].model, cores: cpus().length, platform: platform(), arch: arch() },
        samplesPerWarmCase: 7,
        notes:
          'Wall time of compiler subprocess only. Warm filesystem/TeX caches; excludes debounce, snapshot synchronization, IPC and PDF.js painting. Cold means first build in clean directory, not cold OS caches. Generated projects, not a user thesis.',
        results,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
