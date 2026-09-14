import { _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const temp = await mkdtemp(path.join(tmpdir(), 'quill-sync-ui-'));
const project = path.join(temp, 'project');
await mkdir(project);
await writeFile(
  path.join(project, 'main.tex'),
  String.raw`\documentclass{article}
\begin{document}
First page.
\newpage
\input{body}
\end{document}`,
);
await writeFile(
  path.join(project, 'body.tex'),
  '\\section{Second page}\nA distinctive sentence on the second page.\nAnother paragraph for navigation.\n',
);
const app = await electron.launch({
  args: ['--no-sandbox', '--user-data-dir=' + path.join(temp, 'data'), '.'],
});
try {
  await app.evaluate(({ dialog }, project) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
  }, project);
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page.setViewportSize({ width: 1440, height: 950 });
  page.on('pageerror', (e) => console.log('renderer:', e.message));
  await page.locator('[data-command="openProject"]').first().click();
  await page.locator('#editor .cm-content').waitFor();
  await page.keyboard.press('Control+Enter');
  await page.locator('.pdf-page canvas').first().waitFor({ state: 'attached' });
  const open = async (name) => {
    await page.keyboard.press('Control+p');
    await page.locator('#palette-query').fill(name);
    await page.keyboard.press('Enter');
  };
  await open('body.tex');
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Control+Shift+j');
  await page.locator('.pdf-sync-marker').waitFor();
  assert.equal(
    await page.locator('.pdf-sync-marker').evaluate((el) => el.parentElement.dataset.page),
    '2',
  );
  const checkInverse = async (view) => {
    const box = await view.locator('.pdf-sync-marker').boundingBox();
    assert.ok(box);
    await open('main.tex');
    await view.keyboard.down('Control');
    await view.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await view.keyboard.up('Control');
    await page.waitForFunction(
      () => document.querySelector('#breadcrumb-file').textContent === 'body.tex',
    );
  };
  await checkInverse(page);
  await page.locator('[data-command="detachPdf"]').click();
  await new Promise((resolve) => setTimeout(resolve, 200));
  const popup = app.windows().find((p) => p !== page);
  assert.ok(popup);
  await page.locator('#editor .cm-content').click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Control+Shift+j');
  await popup.locator('.pdf-sync-marker').waitFor();
  await checkInverse(popup);
  await popup.getByRole('button', { name: 'Reattach', exact: true }).click();
  await page.locator('[data-command="toggleLive"]').click();
  await page.locator('#editor .cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('An unsaved sentence in the live preview.\n');
  const revision = await page.locator('#pdf-content').getAttribute('data-revision');
  await page.waitForFunction(
    (r) => document.querySelector('#pdf-content').dataset.revision !== r,
    revision,
  );
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Control+Shift+j');
  await page.locator('.pdf-sync-marker').waitFor();
  await checkInverse(page);
  console.log(
    'SyncTeX desktop passed: source-to-page, included-file inverse search, detached PDF, unsaved live preview.',
  );
  await page.locator('[data-command="toggleLive"]').click();
  await page.locator('#editor .cm-content').click();
  await page.keyboard.press('Control+s');
} finally {
  await app
    .evaluate(({ BrowserWindow }) => {
      for (const win of BrowserWindow.getAllWindows()) win.destroy();
    })
    .catch(() => {});
  await app.close();
  await rm(temp, { recursive: true, force: true });
}
