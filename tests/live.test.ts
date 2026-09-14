import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveScheduler } from '../src/core/live-scheduler.ts';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { LiveCompiler } = createRequire(import.meta.url)('../desktop/live-compiler.cjs');
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition: () => boolean) {
  for (let i = 0; i < 100 && !condition(); i++) await wait(5);
  assert.ok(condition(), 'Condition must become true');
}
test('live scheduler coalesces typing, serializes jobs and suppresses obsolete results', async () => {
  const runs: { revision: number; resolve: (s: string) => void }[] = [],
    presented: string[] = [];
  const s = new LiveScheduler<string>({
    delay: () => 10,
    run: (revision) => new Promise((resolve) => runs.push({ revision, resolve })),
    present: async (value) => {
      presented.push(value);
    },
    status: () => {},
    cancel: () => {},
  });
  s.setEnabled(true);
  s.changed();
  s.changed();
  await until(() => runs.length === 1);
  s.changed();
  s.changed();
  await wait(25);
  assert.equal(runs.length, 1);
  runs[0].resolve('old');
  await until(() => runs.length === 2);
  assert.deepEqual(presented, []);
  runs[1].resolve('latest');
  await until(() => presented.length === 1);
  assert.deepEqual(presented, ['latest']);
  s.setEnabled(false);
});
test('live scheduler invalidates presentation when typing continues and cancels on disable', async () => {
  let resolveRun: (s: string) => void = () => {},
    valid: (() => boolean) | undefined,
    cancelled = 0;
  const s = new LiveScheduler<string>({
    delay: () => 10,
    run: () =>
      new Promise((resolve) => {
        resolveRun = resolve;
      }),
    present: async (_, check) => {
      valid = check;
    },
    status: () => {},
    cancel: () => {
      cancelled++;
    },
  });
  s.setEnabled(true);
  await wait(25);
  resolveRun('pdf');
  await until(() => !!valid);
  assert.equal(valid!(), true);
  s.changed();
  assert.equal(valid!(), false);
  s.setEnabled(false);
  assert.equal(cancelled, 1);
});
test('scratch compilation uses unsaved buffers, restores closed overlays, and never overwrites source', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'quill-live-test-'));
  const compiler = new LiveCompiler();
  const original = String.raw`\documentclass{article}\begin{document}Saved version\end{document}`;
  try {
    await writeFile(path.join(root, 'main.tex'), original);
    const request = {
      rootFile: 'main.tex',
      compiler: 'latexmk',
      mode: 'fast',
      buffers: [{ path: 'main.tex', text: original.replace('Saved version', 'Unsaved version') }],
    };
    const first = compiler.build(root, request);
    await assert.rejects(() => compiler.build(root, request), /already running/);
    const result = await first;
    assert.equal(result.ok, true, result.log);
    assert.equal(Buffer.from(result.pdf).subarray(0, 4).toString(), '%PDF');
    assert.equal(await readFile(path.join(root, 'main.tex'), 'utf8'), original);
    await assert.rejects(() => access(path.join(root, 'main.pdf')));
    assert.match(
      await readFile(path.join(compiler.directory, 'main.tex'), 'utf8'),
      /Unsaved version/,
    );
    const restored = await compiler.build(root, { ...request, buffers: [] });
    assert.ok(restored.ok);
    assert.equal(await readFile(path.join(compiler.directory, 'main.tex'), 'utf8'), original);
    const invalid = await compiler.build(root, {
      ...request,
      buffers: [
        { path: 'main.tex', text: original.replace('Saved version', '\\undefinedcommand') },
      ],
    });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.pdf, undefined);
    await assert.rejects(
      () => compiler.build(root, { ...request, buffers: [{ path: '../escape.tex', text: 'x' }] }),
      /outside/,
    );
  } finally {
    const scratch = compiler.directory;
    await compiler.dispose();
    if (scratch) await assert.rejects(() => access(scratch));
    await rm(root, { recursive: true, force: true });
  }
});
