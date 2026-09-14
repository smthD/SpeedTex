import { _electron as electron } from '@playwright/test';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const temp = await mkdtemp(path.join(tmpdir(), 'quill-live-e2e-'));
const project = path.join(temp, 'project');
await cp('examples/math-notes', project, { recursive: true });
let original = await readFile(path.join(project, 'main.tex'), 'utf8');
original = original.replace(
  '\\begin{document}',
  '\\newcommand{\\iteration}{0}\n\\begin{document}\nVersion: \\iteration.',
);
original = original.replace(
  '\\end{document}',
  String.raw`\newpage\section{Second page}Keep this position.\par ` +
    'Reading notes. $x^2+1$.\\par '.repeat(30) +
    String.raw`\newpage\section{Third page}End.\end{document}`,
);
await writeFile(path.join(project, 'main.tex'), original);
const app = await electron.launch({
  timeout: 20000,
  args: ['--no-sandbox', '--user-data-dir=' + path.join(temp, 'user-data'), '.'],
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.waitForSelector('.cm-content');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, project);
  await page.locator('[data-command="openProject"]').first().click();
  await page.waitForFunction(
    () => document.querySelector('#breadcrumb-file')?.textContent === 'main.tex',
  );
  await page.locator('#live-toggle').click();
  await page.waitForFunction(
    () => document.querySelector('#live-status').dataset.state === 'ready',
  );
  const results = [
    {
      kind: 'cold-enable',
      ...JSON.parse(await page.locator('#live-status').getAttribute('data-metrics')),
    },
  ];
  const replace = async (text) => {
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(text);
  };
  let iteration = 0;
  for (const [mode, delay] of [
    ['accurate', 350],
    ['fast', 350],
    ['fast', 100],
  ]) {
    if (mode === 'fast') {
      const old = await page.locator('#live-status').getAttribute('data-samples');
      await page.locator('[data-command="settings"]').first().click();
      await page.locator('[name="liveMode"]').selectOption(mode);
      await page.locator('[name="liveDelay"]').fill(String(delay));
      await page.getByRole('button', { name: 'Save settings', exact: true }).click();
      await page.locator('#dialog-close').click();
      await page.waitForFunction(
        (old) => document.querySelector('#live-status').dataset.samples !== old,
        old,
      );
    }
    for (let n = 0; n < 7; n++) {
      const previous = await page.locator('#live-status').getAttribute('data-samples');
      iteration++;
      await replace(original.replace('{\\iteration}{0}', `{\\iteration}{${iteration}}`));
      await page.waitForFunction(
        (old) => document.querySelector('#live-status').dataset.samples !== old,
        previous,
      );
      const sample = JSON.parse(await page.locator('#live-status').getAttribute('data-metrics'));
      results.push({ kind: 'warm-edit', debounceMs: delay, ...sample });
      console.log(JSON.stringify(sample));
      assert.equal(
        await readFile(path.join(project, 'main.tex'), 'utf8'),
        original,
        'Live preview must not save source buffers',
      );
      assert.equal(await page.locator('#save-status').textContent(), 'Unsaved changes');
      assert.equal(
        await page.locator('#build-panel').isVisible(),
        false,
        'Live updates must not open the build output panel',
      );
    }
  }
  await page.getByRole('spinbutton', { name: 'PDF page', exact: true }).fill('2');
  await page.getByRole('spinbutton', { name: 'PDF page', exact: true }).press('Enter');
  await page.screenshot({ path: 'docs/live-preview.png' });
  const revision = await page.locator('#pdf-content').getAttribute('data-revision');
  await replace(original.replace('Version:', '\\undefinedcommand Version:'));
  await page.waitForFunction(
    () => document.querySelector('#live-status').dataset.state === 'invalid',
  );
  assert.equal(await page.locator('#pdf-content').getAttribute('data-revision'), revision);
  assert.ok(await page.locator('.pdf-page[data-page="2"] canvas').count());
  const prev = await page.locator('#live-status').getAttribute('data-samples');
  await replace(original.replace('{\\iteration}{0}', '{\\iteration}{99}'));
  await page.waitForFunction(
    (old) => document.querySelector('#live-status').dataset.samples !== old,
    prev,
  );
  assert.equal(await page.locator('.pdf-page-number').inputValue(), '2');
  await page.locator('#live-toggle').click();
  const stopped = await page.locator('#pdf-content').getAttribute('data-revision');
  await replace(original);
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(await page.locator('#pdf-content').getAttribute('data-revision'), stopped);
  assert.deepEqual(errors, []);
  assert.equal(await readFile(path.join(project, 'main.tex'), 'utf8'), original);
  await writeFile(
    'research/live-current-e2e.json',
    JSON.stringify(
      {
        date: new Date().toISOString(),
        viewport: { width: 1440, height: 950 },
        debounceMs: [350, 100],
        fixture:
          'Sample notes plus two added pages; generated edits replace one used macro value; 7 warm edits per mode/debounce combination; fast tests reuse accurate bibliography caches',
        results,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'Live experiment passed: unsaved source rendering, page retention, invalid syntax recovery, quiet updates, and disable.',
  );
} finally {
  const proc = app.process();
  const exit = new Promise((resolve) => proc.once('exit', resolve));
  proc.kill();
  await exit;
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
