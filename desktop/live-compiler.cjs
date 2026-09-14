const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { resolveInside } = require('./files.cjs');
const ignoredDirs = new Set(['.git', '.quill', 'node_modules', 'dist', 'snapshots', 'experiments']);
const generated = /\.(aux|log|toc|out|fls|fdb_latexmk|synctex\.gz)$/;

/** Scratch project compiler. Never saves editor buffers or build artifacts into
 * the user's project. One reusable scratch directory keeps intermediate files warm.
 * This is isolation for editing safety, not a sandbox for untrusted TeX execution.
 */
class LiveCompiler {
  constructor() {
    this.root = null;
    this.directory = null;
    this.files = new Map();
    this.overlays = new Set();
    this.busy = false;
    this.process = null;
    this.cancelled = false;
    this.idle = Promise.resolve();
  }
  cancel() {
    this.cancelled = true;
    if (this.process)
      try {
        if (process.platform === 'win32') this.process.kill();
        else process.kill(-this.process.pid, 'SIGTERM');
      } catch {}
  }
  async dispose() {
    this.cancel();
    await this.idle;
    if (this.directory) {
      await fs.rm(this.directory, { recursive: true, force: true });
      this.directory = null;
    }
  }
  async sync(root, rootFile, buffers) {
    if (this.root !== root) {
      if (this.directory) await fs.rm(this.directory, { recursive: true, force: true });
      this.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'quill-live-'));
      this.root = root;
      this.files.clear();
      this.overlays.clear();
    }
    const seen = new Set(),
      incoming = new Set(buffers.map((b) => b.path));
    const output = path.basename(rootFile).replace(/\.tex$/, '.pdf');
    const walk = async (relative = '') => {
      for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
        if (this.cancelled) throw Error('Live build cancelled');
        if (entry.isSymbolicLink()) continue;
        const rel = relative ? relative + '/' + entry.name : entry.name;
        if (entry.isDirectory()) {
          if (ignoredDirs.has(entry.name)) continue;
          await fs.mkdir(path.join(this.directory, rel), { recursive: true });
          await walk(rel);
          continue;
        }
        if (!entry.isFile() || generated.test(rel) || rel === output) continue;
        seen.add(rel);
        const stat = await fs.stat(path.join(root, rel));
        const stamp = `${stat.mtimeMs}:${stat.size}`;
        if (this.files.get(rel) !== stamp || (this.overlays.has(rel) && !incoming.has(rel))) {
          await fs.copyFile(path.join(root, rel), path.join(this.directory, rel));
          this.files.set(rel, stamp);
        }
      }
    };
    await walk();
    for (const rel of new Set([...this.files.keys(), ...this.overlays]))
      if (!seen.has(rel) && !incoming.has(rel)) {
        await fs.rm(path.join(this.directory, rel), { force: true });
        this.files.delete(rel);
      }
    for (const buffer of buffers) {
      if (
        typeof buffer.path !== 'string' ||
        typeof buffer.text !== 'string' ||
        !/\.(tex|bib|sty|cls|txt)$/.test(buffer.path)
      )
        throw Error('Invalid live source buffer');
      // Validate both containment and real parent paths before creating anything.
      await resolveInside(root, buffer.path, true);
      const target = await resolveInside(this.directory, buffer.path, true);
      await fs.writeFile(target, buffer.text, 'utf8');
    }
    this.overlays = incoming;
  }
  async build(root, request) {
    if (this.busy) throw Error('Live compiler is already running');
    if (
      !['accurate', 'fast'].includes(request.mode) ||
      !['latexmk', 'pdflatex', 'xelatex', 'lualatex'].includes(request.compiler) ||
      typeof request.rootFile !== 'string' ||
      !request.rootFile.endsWith('.tex') ||
      !Array.isArray(request.buffers)
    )
      throw Error('Invalid live build request');
    this.busy = true;
    this.idle = new Promise((resolve) => {
      this.resolveIdle = resolve;
    });
    this.cancelled = false;
    const started = performance.now();
    try {
      await resolveInside(root, request.rootFile);
      if (this.cancelled) throw Error('Live build cancelled');
      await this.sync(root, request.rootFile, request.buffers);
      if (this.cancelled) throw Error('Live build cancelled');
      const synced = performance.now();
      const engine =
        request.compiler === 'latexmk' ? request.engine || 'pdflatex' : request.compiler;
      if (!['pdflatex', 'xelatex', 'lualatex'].includes(engine))
        throw Error('Unsupported TeX engine');
      const program = request.mode === 'accurate' ? 'latexmk' : engine;
      const args = [
        ...(program === 'latexmk'
          ? [
              '-norc',
              engine === 'xelatex' ? '-xelatex' : engine === 'lualatex' ? '-lualatex' : '-pdf',
            ]
          : []),
        '-synctex=1',
        '-interaction=nonstopmode',
        '-file-line-error',
        '-halt-on-error',
        '-no-shell-escape',
        request.rootFile,
      ];
      let log = '',
        timedOut = false;
      const code = await new Promise((resolve, reject) => {
        const child = spawn(program, args, {
          cwd: this.directory,
          shell: false,
          windowsHide: true,
          detached: process.platform !== 'win32',
        });
        this.process = child;
        const timer = setTimeout(() => {
          timedOut = true;
          this.cancel();
        }, 15000);
        const output = (b) => {
          log = (log + b.toString()).slice(-80000);
        };
        child.stdout.on('data', output);
        child.stderr.on('data', output);
        child.once('error', (e) => {
          clearTimeout(timer);
          reject(e);
        });
        child.once('close', (code) => {
          clearTimeout(timer);
          resolve(code);
        });
      });
      const compiled = performance.now();
      const metrics = {
        syncMs: Math.round(synced - started),
        compileMs: Math.round(compiled - synced),
      };
      if (this.cancelled || code !== 0)
        return {
          ok: false,
          code,
          log: timedOut ? 'Live build timed out after 15 seconds.\n' + log : log,
          metrics,
        };
      const pdf = new Uint8Array(
        await fs.readFile(
          path.join(this.directory, path.basename(request.rootFile).replace(/\.tex$/, '.pdf')),
        ),
      );
      // Capture while the build remains busy, before another job can mutate
      // the reusable scratch directory or its SyncTeX sidecar.
      let preview = { pdf, syncId: null };
      if (this.capture) {
        try {
          preview = await this.capture(
            root,
            this.directory,
            path.join(this.directory, path.basename(request.rootFile).replace(/\.tex$/, '.pdf')),
          );
        } catch {
          /* Keep PDF viewing available if synchronization data fails. */
        }
      }
      return {
        ok: true,
        code,
        ...preview,
        log,
        metrics: { ...metrics, totalMs: Math.round(performance.now() - started) },
      };
    } finally {
      this.busy = false;
      this.process = null;
      this.resolveIdle();
    }
  }
}
module.exports = { LiveCompiler };
