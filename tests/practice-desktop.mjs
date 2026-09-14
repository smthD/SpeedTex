import { _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const temp = await mkdtemp(path.join(tmpdir(), 'quill-practice-'));
const app = await electron.launch({ args: ['--no-sandbox', '--user-data-dir=' + temp, '.'] });
try {
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 950 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.locator('[data-command="practice"]').click();
  await page.locator('#practice-target svg').first().waitFor();
  for (const style of ['physics', 'mathematics']) {
    await page.locator('#practice-style').selectOption(style);
    await page.locator('#practice-difficulty').selectOption('extended');
    for (let n = 0; n < 7; n++) {
      await page.locator('#practice-next').click();
      await page.locator('#practice-target svg').first().waitFor();
    }
  }
  const input = page.locator('#practice-editor .cm-content');
  await input.click();
  await page.keyboard.press('Control+a');
  const start = Date.now();
  await page.keyboard.insertText(
    '\\[\\pdv[2]{f}{x}+\\bra{\\psi}\\hat{H}\\ket{\\phi}+\\mathbb{R}\\]',
  );
  await page.locator('#practice-output svg').first().waitFor();
  const latency = Date.now() - start;
  const svg = await page.locator('#practice-output').innerHTML();
  await page.keyboard.insertText('\\unknowncommand{');
  await page.waitForFunction(() =>
    document.querySelector('#practice-render-status').textContent.includes('Incomplete'),
  );
  assert.equal(await page.locator('#practice-output').innerHTML(), svg);
  await page.screenshot({ path: 'docs/practice-desktop.png' });
  await page.locator('#practice-close').click();
  await page.locator('[data-command="practice"]').click();
  await page.locator('#practice-target svg').first().waitFor();
  assert.deepEqual(errors, []);
  console.log(
    `Practice desktop passed: bundled fonts, physics/AMS notation, invalid-input retention, reopen. Edit-to-SVG ${latency} ms.`,
  );
} finally {
  await app.close();
  await rm(temp, { recursive: true, force: true });
}
