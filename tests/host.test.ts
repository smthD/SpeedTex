import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { read, write, resolveInside, list } = createRequire(import.meta.url)('../desktop/files.cjs');
test('host detects external changes and keeps external content intact', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quill-test-'));
  try {
    await writeFile(path.join(root, 'main.tex'), 'initial');
    const before = await read(root, 'main.tex');
    await writeFile(path.join(root, 'main.tex'), 'external');
    await assert.rejects(() => write(root, 'main.tex', 'mine', before.version), /CONFLICT/);
    assert.equal(await readFile(path.join(root, 'main.tex'), 'utf8'), 'external');
    const current = await read(root, 'main.tex');
    await write(root, 'main.tex', 'saved', current.version);
    assert.equal((await read(root, 'main.tex')).text, 'saved');
    await assert.rejects(() => write(root, 'main.tex', 'overwrite', null), /CONFLICT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('host rejects traversal and escaping symlinks', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quill-test-'));
  try {
    await assert.rejects(() => resolveInside(root, '../secret'), /outside/);
    await symlink('/tmp', path.join(root, 'escape'));
    await assert.rejects(() => resolveInside(root, 'escape'), /Symlink/);
    await mkdir(path.join(root, 'sections'));
    await writeFile(path.join(root, 'sections', 'one.tex'), 'test');
    const entries = await list(root);
    assert.ok(entries.some((e) => e.path === 'sections/one.tex'));
    assert.ok(!entries.some((e) => e.path === 'escape'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
