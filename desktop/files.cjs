const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');
async function resolveInside(root, relative, allowMissing = false) {
  if (typeof relative !== 'string' || path.isAbsolute(relative))
    throw Error('Expected a project-relative path');
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(root + path.sep))
    throw Error('Path outside project');
  let real;
  try {
    real = await fs.realpath(resolved);
  } catch (e) {
    if (!allowMissing || e.code !== 'ENOENT') throw e;
    real = path.join(await fs.realpath(path.dirname(resolved)), path.basename(resolved));
  }
  if (real !== root && !real.startsWith(root + path.sep)) throw Error('Symlink outside project');
  return resolved;
}
async function read(root, name) {
  const p = await resolveInside(root, name);
  const text = await fs.readFile(p, 'utf8');
  return { text, version: hash(text) };
}
async function write(root, name, text, version) {
  const p = await resolveInside(root, name, true);
  let current = null;
  try {
    current = hash(await fs.readFile(p));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (current !== version)
    throw Error(
      'CONFLICT: The file changed on disk. Reload it or save your version under a new name.',
    );
  const tmp = p + '.quill-' + crypto.randomUUID() + '.tmp';
  try {
    await fs.writeFile(tmp, text, 'utf8');
    await fs.rename(tmp, p);
  } finally {
    await fs.rm(tmp, { force: true });
  }
  return { version: hash(text) };
}
async function list(root, dir = '') {
  const out = [];
  for (const ent of await fs.readdir(await resolveInside(root, dir), { withFileTypes: true })) {
    if (
      ent.name.startsWith('.') ||
      ['node_modules', 'dist'].includes(ent.name) ||
      ent.isSymbolicLink()
    )
      continue;
    const name = dir ? dir + '/' + ent.name : ent.name;
    if (ent.isDirectory()) {
      out.push({ path: name, directory: true });
      out.push(...(await list(root, name)));
    } else if (/\.(tex|bib|sty|cls|md|txt|json|png|jpg|pdf)$/i.test(name))
      out.push({ path: name, directory: false });
  }
  return out;
}
module.exports = { resolveInside, read, write, list, hash };
