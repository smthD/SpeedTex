import { _electron as electron } from '@playwright/test';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const testRoot = await mkdtemp(path.join(tmpdir(), 'quill-desktop-'));
const project = path.join(testRoot, 'project');
await cp('examples/math-notes', project, { recursive: true });
const sample = await readFile(path.join(project, 'main.tex'), 'utf8');
const extra = Array.from(
  { length: 5 },
  (_, i) =>
    String.raw`\newpage\section{Preview test page ${i + 2}}This page checks position retention after rebuilding.\par $x^{2}+1$\par ${String.raw`Mathematical notes continue here, with equations and explanations. $f(x)=x^2+1$.\par `.repeat(12)}`,
).join('\n');
await writeFile(
  path.join(project, 'main.tex'),
  sample.replace(String.raw`\end{document}`, extra + '\n' + String.raw`\end{document}`),
);
console.log('Launching desktop…');
const app = await electron.launch({
  timeout: 20000,
  args: ['--no-sandbox', '--user-data-dir=' + path.join(testRoot, 'user-data'), '.'],
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
});
try {
  console.log('Desktop launched');
  const page = await app.firstWindow({ timeout: 15000 });
  page.setDefaultTimeout(15000);
  await page.setViewportSize({ width: 1440, height: 950 });
  page.on('console', (m) => console.log('renderer:', m.text()));
  page.on('pageerror', (e) => console.log('renderer error:', e.message));
  console.log('Waiting for editor');
  await page.waitForSelector('.cm-content');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  console.log('Opening project');
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, project);
  await page.locator('[data-command="openProject"]').first().click();
  await page.waitForFunction(
    () => document.querySelector('#breadcrumb-file')?.textContent === 'main.tex',
  );
  assert.match(await page.locator('.cm-content').innerText(), /documentclass/);
  // Invoke the same narrow host API used by the UI to check disk conflict behavior.
  const r = await page.evaluate(() => window.quill.read('main.tex'));
  await writeFile(path.join(project, 'main.tex'), r.text + '\n% external edit\n');
  const error = await page.evaluate(async (version) => {
    try {
      await window.quill.write('main.tex', 'should not overwrite', version);
      return '';
    } catch (e) {
      return e.message;
    }
  }, r.version);
  assert.match(error, /CONFLICT/);
  assert.match(await readFile(path.join(project, 'main.tex'), 'utf8'), /external edit/);
  console.log('Building project');
  await page.locator('[data-command="build"]').first().click();
  await page.waitForFunction(
    () =>
      ['Completed', 'Failed', 'Could not start'].includes(
        document.querySelector('#build-result')?.textContent,
      ),
    {},
    { timeout: 60000 },
  );
  assert.equal(
    await page.locator('#build-result').textContent(),
    'Completed',
    await page.locator('#build-output').innerText(),
  );
  const pdf = await readFile(path.join(project, 'main.pdf'));
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  await page.locator('[data-command="togglePreview"]').first().click();
  await page.waitForSelector('#pdf-content .pdf-page canvas');
  await page.waitForFunction(() => !!document.querySelector('#pdf-content')?.dataset.revision);
  assert.equal(await page.locator('#pdf-content iframe').count(), 0);
  await page.getByRole('spinbutton', { name: 'PDF page', exact: true }).fill('4');
  await page.getByRole('spinbutton', { name: 'PDF page', exact: true }).press('Tab');
  await page.getByRole('combobox', { name: 'PDF zoom' }).selectOption('125');
  await page.locator('.pdf-scroll').evaluate((el) => {
    el.scrollTop += 200;
  });
  const position = () =>
    page.evaluate(() => {
      const scroll = document.querySelector('.pdf-scroll');
      const n = Number(document.querySelector('.pdf-page-number').value);
      const rect = document.querySelector(`.pdf-page[data-page="${n}"]`).getBoundingClientRect();
      return {
        page: n,
        fraction: (scroll.getBoundingClientRect().top - rect.top) / rect.height,
        zoom: document.querySelector('.pdf-toolbar select').value,
      };
    });
  // Wait for scroll tracking and the visible page's rasterization before capture.
  await page.waitForFunction(
    () =>
      document.querySelector('.pdf-page-number').value === '4' &&
      !!document.querySelector('.pdf-page[data-page="4"] canvas'),
  );
  const before = await position();
  const revision = await page.locator('#pdf-content').getAttribute('data-revision');
  const source = await readFile(path.join(project, 'main.tex'), 'utf8');
  await writeFile(
    path.join(project, 'main.tex'),
    source.replace('margin=1in', 'paperheight=12in,margin=1in'),
  );
  await page.locator('[data-command="build"]').first().click();
  await page.waitForFunction(
    (old) => {
      const el = document.querySelector('#pdf-content');
      return el?.dataset.revision !== old && !el?.hasAttribute('aria-busy');
    },
    revision,
    { timeout: 60000 },
  );
  const after = await position();
  assert.equal(after.page, before.page);
  assert.equal(after.zoom, before.zoom);
  assert.ok(Math.abs(after.fraction - before.fraction) < 0.01, JSON.stringify({ before, after }));
  const ink = await page.locator('.pdf-page[data-page="4"] canvas').evaluate((canvas) => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i] < 200 && pixels[i + 1] < 200 && pixels[i + 2] < 200) count++;
    return count;
  });
  assert.ok(ink > 100, 'Rendered PDF must contain actual text, not just blank canvases');
  // Hide/show should retain the same reading position as well.
  await page.locator('[data-command="togglePreview"]').first().click();
  await page.locator('[data-command="togglePreview"]').first().click();
  await page.waitForFunction(() => document.querySelector('.pdf-scroll').clientHeight > 0);
  assert.equal((await position()).page, 4);
  const goodPdf = await readFile(path.join(project, 'main.pdf'));
  const goodRevision = await page.locator('#pdf-content').getAttribute('data-revision');
  await writeFile(path.join(project, 'main.pdf'), 'not a complete PDF');
  await page.locator('[data-command="refreshPdf"]').first().click();
  await page.waitForFunction(
    () => document.querySelector('.pdf-update-status').textContent === 'Update failed',
  );
  assert.equal(await page.locator('#pdf-content').getAttribute('data-revision'), goodRevision);
  assert.equal((await position()).page, 4);
  assert.ok(await page.locator('.pdf-page[data-page="4"] canvas').count());
  await writeFile(path.join(project, 'main.pdf'), goodPdf);
  await page.locator('[data-command="refreshPdf"]').first().click();
  await page.waitForFunction(
    (old) => document.querySelector('#pdf-content').dataset.revision !== old,
    goodRevision,
  );
  await page.getByRole('combobox', { name: 'PDF zoom' }).selectOption('fit');
  await page.getByRole('spinbutton', { name: 'PDF page', exact: true }).fill('4');
  await page.getByRole('spinbutton', { name: 'PDF page', exact: true }).press('Enter');
  await page.waitForFunction(() => {
    const p = document.querySelector('.pdf-page[data-page="4"]');
    const canvas = p?.querySelector('canvas');
    return (
      canvas && Math.abs(canvas.width - p.getBoundingClientRect().width * devicePixelRatio) < 3
    );
  });
  await page.waitForFunction(() => !document.querySelector('#toast').classList.contains('visible'));
  await page.screenshot({ path: 'docs/pdf-preview.png' });
  const remembered = await position();
  await page.reload();
  await page.waitForSelector('.cm-content');
  await page.locator('[data-command="openProject"]').first().click();
  await page.waitForFunction(
    () => document.querySelector('#breadcrumb-file')?.textContent === 'main.tex',
  );
  await page.locator('[data-command="togglePreview"]').first().click();
  await page.waitForSelector('.pdf-page[data-page="4"] canvas');
  const reopened = await position();
  assert.equal(reopened.page, remembered.page);
  assert.equal(reopened.zoom, remembered.zoom);
  assert.ok(Math.abs(reopened.fraction - remembered.fraction) < 0.01);

  console.log(
    'PDF rebuild retained page 4, zoom 125%, and relative position across changed page dimensions.',
  );
  // Resize with the divider, then zoom at a particular page coordinate.
  const oldWidth = await page.locator('#preview').evaluate((el) => el.clientWidth);
  const divider = await page.locator('.pdf-splitter').boundingBox();
  await page.mouse.move(divider.x + 3, divider.y + 100);
  await page.mouse.down();
  await page.mouse.move(divider.x - 110, divider.y + 100);
  await page.mouse.up();
  assert.ok((await page.locator('#preview').evaluate((el) => el.clientWidth)) > oldWidth + 80);
  await page.getByRole('combobox', { name: 'PDF zoom' }).selectOption('125');
  const point = await page.locator('.pdf-scroll').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + el.clientWidth * 0.5, y: r.top + el.clientHeight * 0.4 };
  });
  const pagePoint = () =>
    page.locator('.pdf-page[data-page="4"]').evaluate((el, point) => {
      const r = el.getBoundingClientRect();
      return { x: (point.x - r.left) / r.width, y: (point.y - r.top) / r.height };
    }, point);
  const sourcePoint = await pagePoint();
  await page.mouse.click(point.x, point.y, { button: 'middle' });
  await page.waitForFunction(
    () => document.querySelector('[aria-label="PDF zoom"]').value === '250',
  );
  const zoomedPoint = await pagePoint();
  assert.ok(
    Math.abs(sourcePoint.x - zoomedPoint.x) < 0.005 &&
      Math.abs(sourcePoint.y - zoomedPoint.y) < 0.005,
    JSON.stringify({ sourcePoint, zoomedPoint }),
  );
  const checkPanning = async (view) => {
    const snapshot = () =>
      view.locator('.pdf-scroll').evaluate((el) => ({ left: el.scrollLeft, top: el.scrollTop }));
    const before = await snapshot();
    const zoom = await view.getByRole('combobox', { name: 'PDF zoom' }).inputValue();
    const rect = await view.locator('.pdf-scroll').boundingBox();
    const x = rect.x + rect.width / 2,
      y = rect.y + rect.height / 2;
    for (const direction of [-1, 1]) {
      await view.mouse.move(x, y);
      await view.mouse.down({ button: 'middle' });
      await view.mouse.move(x + direction * 40, y + direction * 60, { steps: 8 });
      await view.mouse.up({ button: 'middle' });
      const after = await snapshot();
      assert.ok(Math.abs(after.left - (before.left + (direction === -1 ? 40 : 0))) < 2);
      assert.ok(Math.abs(after.top - (before.top + (direction === -1 ? 60 : 0))) < 2);
      assert.equal(await view.getByRole('combobox', { name: 'PDF zoom' }).inputValue(), zoom);
    }
  };
  await checkPanning(page);
  const detachedPosition = await position();
  await page.locator('#pdf-content').evaluate((el) => (el.dataset.readerIdentity = 'same-reader'));
  const opened = app.waitForEvent('window');
  await page.locator('[data-command="detachPdf"]').click();
  const popup = await opened;
  await popup.waitForSelector('#pdf-content .pdf-page canvas');
  assert.equal(
    await popup.locator('#pdf-content').getAttribute('data-reader-identity'),
    'same-reader',
  );
  assert.equal(await popup.locator('[aria-label="PDF zoom"]').inputValue(), detachedPosition.zoom);
  assert.equal(await popup.locator('.pdf-page-number').inputValue(), String(detachedPosition.page));
  await popup.setViewportSize({ width: 950, height: 760 });
  await checkPanning(popup);
  const oldDetachedRevision = await popup.locator('#pdf-content').getAttribute('data-revision');
  await page.locator('[data-command="build"]').first().click();
  await popup.waitForFunction(
    (old) => document.querySelector('#pdf-content').dataset.revision !== old,
    oldDetachedRevision,
    { timeout: 60000 },
  );
  assert.equal(await popup.locator('.pdf-page-number').inputValue(), String(detachedPosition.page));
  await page.locator('#live-toggle').click();
  await page.waitForFunction(
    () => document.querySelector('#live-status').dataset.state === 'ready',
  );
  const liveRevision = await popup.locator('#pdf-content').getAttribute('data-revision');
  await page.locator('#editor .cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\n% Detached live preview update\n');
  await popup.waitForFunction(
    (old) => document.querySelector('#pdf-content').dataset.revision !== old,
    liveRevision,
    { timeout: 30000 },
  );
  assert.equal(await popup.locator('.pdf-page-number').inputValue(), String(detachedPosition.page));
  await page.locator('#live-toggle').click();
  await page.locator('#editor .cm-content').click();
  await page.keyboard.press('Control+s');
  await page.waitForFunction(
    () => document.querySelector('#save-status').textContent === 'All changes saved',
  );
  await popup.screenshot({ path: 'docs/pdf-detached.png' });
  await popup.getByRole('button', { name: 'Reattach', exact: true }).click();
  await page.waitForSelector('#pdf-content .pdf-page canvas');
  assert.equal(
    await page.locator('#pdf-content').getAttribute('data-reader-identity'),
    'same-reader',
  );
  assert.equal(await page.locator('[aria-label="PDF zoom"]').inputValue(), detachedPosition.zoom);
  const reopenedWindow = app.waitForEvent('window');
  await page.locator('[data-command="detachPdf"]').click();
  const second = await reopenedWindow;
  await second.waitForSelector('#pdf-content');
  await second.close();
  await page.waitForSelector('#pdf-content .pdf-page canvas');
  console.log(
    'PDF resize, pointer zoom, two-axis panning, detached rebuilds, reattachment, and window-close recovery passed.',
  );

  assert.deepEqual(errors, []);
  console.log(
    'Desktop smoke passed: folder open, conflict protection, latexmk build, PDF preview.',
  );
} finally {
  const proc = app.process();
  const exited = new Promise((resolve) => proc.once('exit', resolve));
  // Test cleanup must not wait on an unsaved-file close prompt.
  await app
    .evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy();
    })
    .catch(() => {});
  if (proc.exitCode === null && proc.signalCode === null) {
    proc.kill('SIGTERM');
    await exited;
  }
  await rm(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
