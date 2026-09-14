import { _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const temp = await mkdtemp(path.join(tmpdir(), 'quill-spelling-'));
const project = path.join(temp, 'project');
const data = path.join(temp, 'data');
await mkdir(project);
await writeFile(path.join(project, 'main.tex'), 'This is mispelled. $mathfake$ \\label{labelfake}');
const app = await electron.launch({ args: ['--no-sandbox', '--user-data-dir=' + data, '.'] });
try {
  await app.evaluate(({ dialog }, project) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
  }, project);
  const page = await app.firstWindow();
  await page.locator('[data-command="openProject"]').first().click();
  await page.waitForFunction(() =>
    document.querySelector('#editor .cm-content')?.textContent.includes('mispelled'),
  );
  await page.locator('#editor .cm-spelling-error').waitFor({ timeout: 15000 });
  assert.deepEqual(await page.locator('#editor .cm-spelling-error').allTextContents(), [
    'mispelled',
  ]);
  const mistake = page.locator('#editor .cm-spelling-error');
  const box = await mistake.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.locator('.spelling-menu').waitFor();
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.spelling-menu').isVisible(), true);
  await page.getByRole('button', { name: 'Add to project dictionary' }).click();
  await page.waitForFunction(() => !document.querySelector('#editor .cm-spelling-error'));
  assert.deepEqual(
    JSON.parse(await readFile(path.join(project, '.quill/dictionary.json'), 'utf8')),
    ['mispelled'],
  );
  await page.evaluate(async () => {
    await window.quill.saveDictionary(['quillglobal'], 'global');
    const dictionaries = await window.quill.loadDictionaries();
    if (dictionaries.global[0] !== 'quillglobal' || dictionaries.project[0] !== 'mispelled')
      throw Error('Scopes mixed');
  });
  assert.deepEqual(
    JSON.parse(await readFile(path.join(data, 'configuration/dictionary.json'), 'utf8')),
    ['quillglobal'],
  );
  await page.reload();
  await page.locator('#editor .cm-content').waitFor();
  await page.evaluate(async () => {
    const dictionaries = await window.quill.loadDictionaries();
    if (!dictionaries.project.includes('mispelled'))
      throw Error('Project dictionary did not persist');
  });
  console.log(
    'Desktop spelling passed: bundled offline worker, keyboard suggestions, separate global/project JSON dictionaries, reload.',
  );
} finally {
  await app.close();
  await rm(temp, { recursive: true, force: true });
}
