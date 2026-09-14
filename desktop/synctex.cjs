const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const gunzip = promisify(require('node:zlib').gunzip);
const runFile = promisify(execFile);
const files = require('./files.cjs');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function records(output) {
  const result = [];
  let current = {};
  for (const line of output.split(/\r?\n/)) {
    const m = /^([A-Za-z]+):(.*)$/.exec(line);
    if (!m) continue;
    if (m[1] === 'Output' && Object.keys(current).length) {
      result.push(current);
      current = {};
    }
    current[m[1]] = m[2];
  }
  if (Object.keys(current).length) result.push(current);
  return result;
}
class SyncTexStore {
  constructor() {
    this.items = new Map();
    this.pinned = null;
    this.directory = null;
  }
  async capture(root, cwd, pdfPath) {
    const pdf = new Uint8Array(await fs.readFile(pdfPath));
    let data, suffix;
    for (const ext of ['.synctex.gz', '.synctex']) {
      try {
        data = await fs.readFile(pdfPath.replace(/\.pdf$/i, ext));
        suffix = ext;
        break;
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
    if (!data) return { pdf, syncId: null };
    const text = (
      suffix.endsWith('.gz') ? await gunzip(data, { maxOutputLength: 64 * 1024 * 1024 }) : data
    ).toString('utf8');
    const sources = new Map();
    const pdfTime = (await fs.stat(pdfPath)).mtimeMs;
    let outdated = false;
    for (const line of text.split(/\r?\n/)) {
      const m = /^Input:\d+:(.*)$/.exec(line);
      if (!m) continue;
      const full = path.resolve(cwd, m[1]);
      const relative = path.relative(cwd, full);
      if (
        relative.startsWith('..') ||
        path.isAbsolute(relative) ||
        !/\.(tex|sty|cls)$/i.test(relative)
      )
        continue;
      try {
        const original = await files.resolveInside(root, relative);
        const source = await fs.readFile(full);
        if ((await fs.stat(full)).mtimeMs > pdfTime + 1) outdated = true;
        sources.set(relative.split(path.sep).join('/'), {
          input: m[1],
          hash: hash(source),
          original,
        });
      } catch {
        /* TeX/system inputs outside the project are not navigation targets. */
      }
    }
    if (outdated || !sources.size) return { pdf, syncId: null };
    if (!this.directory)
      this.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'quill-synctex-'));
    const id = randomUUID(),
      dir = path.join(this.directory, id);
    await fs.mkdir(dir);
    const output = path.join(dir, path.basename(pdfPath));
    await fs.writeFile(output, pdf);
    await fs.writeFile(output.replace(/\.pdf$/i, suffix), data);
    this.items.set(id, { root, cwd, output, sources });
    for (const [old, item] of this.items) {
      if (this.items.size <= 6) break;
      if (old === this.pinned) continue;
      this.items.delete(old);
      await fs.rm(path.dirname(item.output), { recursive: true, force: true });
    }
    return { pdf, syncId: id };
  }
  get(root, id) {
    const item = this.items.get(id);
    if (!item || item.root !== root)
      throw Error('SyncTeX map is unavailable. Rebuild the document.');
    return item;
  }
  retain(root, id) {
    if (id) this.get(root, id);
    this.pinned = id;
  }
  async run(args, cwd) {
    const env = { ...process.env };
    delete env.SYNCTEX_EDITOR;
    delete env.SYNCTEX_VIEWER;
    try {
      const { stdout } = await runFile('synctex', args, {
        cwd,
        env,
        timeout: 5000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      });
      return records(stdout);
    } catch (e) {
      throw Error(
        e.code === 'ENOENT'
          ? 'Install SyncTeX with your TeX distribution to use PDF/source navigation.'
          : 'SyncTeX could not locate this position. Rebuild with -synctex=1.',
      );
    }
  }
  async forward(root, id, file, line, column, text) {
    if (
      !Number.isInteger(line) ||
      line < 1 ||
      !Number.isInteger(column) ||
      column < 1 ||
      typeof text !== 'string'
    )
      throw Error('Invalid source position.');
    const item = this.get(root, id),
      source = item.sources.get(file);
    if (!source) throw Error('This source file is not included in the displayed PDF.');
    await files.resolveInside(root, file);
    if (hash(text) !== source.hash)
      throw Error(
        'Source changed since this PDF was built. Wait for live preview or rebuild before navigating.',
      );
    const rows = await this.run(
      ['view', '-i', `${line}:${column}:${source.input}`, '-o', item.output],
      item.cwd,
    );
    const row = rows.find(
      (r) => Number(r.Page) > 0 && Number.isFinite(Number(r.x)) && Number.isFinite(Number(r.y)),
    );
    if (!row)
      throw Error(
        'No PDF position found for this source line. Try a line containing typeset text.',
      );
    return { page: Number(row.Page), x: Number(row.x), y: Number(row.y) };
  }
  async inverse(root, id, page, x, y) {
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < 0 ||
      y < 0
    )
      throw Error('Invalid PDF position.');
    const item = this.get(root, id);
    const rows = await this.run(['edit', '-o', `${page}:${x}:${y}:${item.output}`], item.cwd);
    for (const row of rows) {
      if (!row.Input || !(Number(row.Line) > 0)) continue;
      const full = path.resolve(item.cwd, row.Input);
      const entry = [...item.sources].find(([, s]) => path.resolve(item.cwd, s.input) === full);
      if (!entry) continue;
      const [file, source] = entry;
      await files.resolveInside(root, file);
      return {
        file,
        line: Number(row.Line),
        column: Math.max(1, Number(row.Column) || 1),
        hash: source.hash,
      };
    }
    throw Error('No project source position found here. Try clicking on typeset text.');
  }
  async dispose() {
    if (this.directory) await fs.rm(this.directory, { recursive: true, force: true });
    this.items.clear();
  }
}
module.exports = { SyncTexStore, records, hash };
