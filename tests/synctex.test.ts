import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { SyncTexStore } = require('../desktop/synctex.cjs');
const run = promisify(execFile);
test('real SyncTeX maps included files both ways and retains immutable versions', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quill-sync-test-'));
  const store = new SyncTexStore();
  try {
    await mkdir(path.join(root, 'sections'));
    const text = 'A distinctive sentence on the second page.\n';
    await writeFile(
      path.join(root, 'main.tex'),
      String.raw`\documentclass{article}\begin{document}First page.\newpage\input{sections/body}\end{document}`,
    );
    await writeFile(path.join(root, 'sections/body.tex'), text);
    await run(
      'pdflatex',
      ['-interaction=nonstopmode', '-halt-on-error', '-synctex=1', 'main.tex'],
      { cwd: root },
    );
    const snapshot = await store.capture(root, root, path.join(root, 'main.pdf'));
    assert.ok(snapshot.syncId);
    store.retain(root, snapshot.syncId);
    const position = await store.forward(root, snapshot.syncId, 'sections/body.tex', 1, 10, text);
    assert.equal(position.page, 2);
    const source = await store.inverse(
      root,
      snapshot.syncId,
      position.page,
      position.x,
      position.y,
    );
    assert.equal(source.file, 'sections/body.tex');
    assert.equal(source.line, 1);
    await assert.rejects(
      store.forward(root, snapshot.syncId, 'sections/body.tex', 1, 1, text + 'changed'),
      /Source changed/,
    );
    await assert.rejects(store.inverse(root + 'other', snapshot.syncId, 1, 1, 1), /unavailable/);
    await assert.rejects(store.forward(root, snapshot.syncId, '../outside.tex', 1, 1, ''));
    await writeFile(path.join(root, 'sections/body.tex'), 'New content.');
    const stale = await store.capture(root, root, path.join(root, 'main.pdf'));
    assert.equal(stale.syncId, null);
    // Overwriting the compiler output cannot overwrite the displayed version's map.
    await run(
      'pdflatex',
      ['-interaction=nonstopmode', '-halt-on-error', '-synctex=1', 'main.tex'],
      { cwd: root },
    );
    const original = await store.forward(root, snapshot.syncId, 'sections/body.tex', 1, 10, text);
    assert.deepEqual(original, position);
  } finally {
    await store.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
