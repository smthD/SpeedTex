import { _electron as electron } from '@playwright/test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const temp = await mkdtemp(path.join(tmpdir(), 'quill-clipboard-'));
await writeFile(path.join(temp, 'main.tex'), '3x+5x');
// Preserve the desktop clipboard while exercising the native clipboard bridge.
const app = await electron.launch({
  args: ['--no-sandbox', '--user-data-dir=' + path.join(temp, 'data'), '.'],
});
try {
  await app.evaluate(async ({ clipboard }) => {
    globalThis.clipboardBeforeTest = await clipboard.read();
  });
  const page = await app.firstWindow();
  await page.locator('#editor .cm-content').waitFor();
  await app.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
  }, temp);
  await page.locator('[data-command="openProject"]').first().click();
  await page.waitForFunction(
    () => document.querySelector('#editor .cm-content').textContent === '3x+5x',
  );
  await page.locator('#editor .cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Alt+o');
  await page.waitForFunction(
    () => document.querySelector('#editor .cm-content').textContent === '3x+',
  );
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), '5x');
  await app.evaluate(({ clipboard }) => clipboard.writeText('\\alpha+1'));
  await page.keyboard.press('Alt+l');
  await page.waitForFunction(
    () => document.querySelector('#editor .cm-content').textContent === '3x+\\alpha+1',
  );
  console.log('Desktop clipboard passed: native cut text and externally supplied clipboard paste.');
} finally {
  await app
    .evaluate(({ clipboard }) => {
      if (globalThis.clipboardBeforeTest) return clipboard.write(globalThis.clipboardBeforeTest);
    })
    .catch(() => {});
  await app.close();
  await rm(temp, { recursive: true, force: true });
}
