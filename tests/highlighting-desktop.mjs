import { _electron as electron } from '@playwright/test';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const temp = await mkdtemp(path.join(tmpdir(), 'quill-highlight-'));
const project = path.join(temp, 'project');
await mkdir(project);
await writeFile(path.join(project, 'main.tex'), '\\documentclass{article}');
const app = await electron.launch({ args: ['--no-sandbox', '--user-data-dir=' + temp, '.'] });
try {
  await app.evaluate(({ dialog }, project) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
  }, project);
  const page = await app.firstWindow();
  await page.locator('[data-command="openProject"]').first().click();
  await page.setViewportSize({ width: 1440, height: 950 });
  const input = page.locator('#editor .cm-content');
  await page.waitForFunction(() =>
    document.querySelector('#editor .cm-content')?.textContent.includes('documentclass'),
  );
  page.on('pageerror', (e) => console.log('renderer:', e.message));
  await input.click();
  await page.keyboard.press('Control+a');
  const text = String.raw`\begin{equation}
  \left\langle \frac{x^{2}+1}{\sqrt{y}} \middle| \psi \right\rangle
\end{equation}`;
  await page.keyboard.insertText(text);
  await page.keyboard.press('Control+Home');
  for (let i = 0; i < text.indexOf('2'); i++) await page.keyboard.press('ArrowRight');
  await page
    .waitForFunction(() => document.querySelectorAll('#editor .cm-latex-active').length === 2)
    .catch(async (error) => {
      console.log(await input.innerHTML());
      console.log(await page.locator('#position').textContent());
      throw error;
    });
  assert.equal(await input.locator('.cm-latex-unmatched').count(), 0);
  await page.screenshot({ path: 'docs/highlighting-desktop.png' });
  await page.locator('[data-command="settings"]').first().click();
  await page.locator('[data-settings="highlighting"]').click();
  await page.getByRole('button', { name: 'Blueprint', exact: true }).click();
  await page.getByRole('button', { name: 'Save highlighting' }).click();
  await page.waitForFunction(
    () => document.querySelector('#toast').textContent === 'Highlighting saved',
  );
  const stored = await page.evaluate(() => window.quill.loadConfig());
  assert.equal(stored.global.settings.delimiterHighlight.mode, 'kind');
  console.log(
    'Desktop highlighting passed: bundled parser worker, nested active pair, middle fences, preset persistence.',
  );
} finally {
  await app
    .evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) w.destroy();
    })
    .catch(() => {});
  await app.close();
  await rm(temp, { recursive: true, force: true });
}
