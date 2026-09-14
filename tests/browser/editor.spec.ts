import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.cm-content')).toContainText('documentclass');
});
async function replace(page: any, text: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(text);
}
test('editor opens and file navigation / symbol palette work', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await expect(page.locator('.outline-section')).toContainText('Introduction');
  await page.screenshot({ path: 'docs/editor-dark.png' });
  await page.keyboard.press('Control+p');
  await page.locator('#palette-query').fill('remarks');
  await page.keyboard.press('Enter');
  await expect(page.locator('#breadcrumb-file')).toHaveText('sections/remarks.tex');
  await expect(page.locator('.cm-content')).toContainText('Further remarks');
  await page.keyboard.press('Control+Shift+o');
  await page.locator('#palette-query').fill('limits');
  await page.keyboard.press('Enter');
  await expect(page.locator('#breadcrumb-file')).toHaveText('main.tex');
  expect(errors).toEqual([]);
});
test('fraction expansion and nested placeholders preserve denominator', async ({ page }) => {
  await replace(page, '$');
  await page.keyboard.type('fr/');
  await expect(page.locator('.cm-content')).toHaveText('$\\frac{}{}$');
  await page.keyboard.type('sq/');
  await page.keyboard.type('x');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.type('y');
  await expect(page.locator('.cm-content')).toHaveText('$\\frac{\\sqrt{x}}{y}$');
  await page.keyboard.press('Tab');
  await page.keyboard.type('+z');
  await expect(page.locator('.cm-content')).toHaveText('$\\frac{\\sqrt{x}}{y}+z$');
});
test('text mode does not expand math snippets; smart pairs and scripts work', async ({ page }) => {
  await replace(page, 'prose ');
  await page.keyboard.type('fr/');
  await expect(page.locator('.cm-content')).toHaveText('prose fr/');
  await replace(page, '$x');
  await page.keyboard.type('^2');
  await page.keyboard.press('Tab');
  await page.keyboard.type('+');
  await expect(page.locator('.cm-content')).toHaveText('$x^{2}+');
});
test('custom snippet GUI persists rule and makes it typeable', async ({ page }) => {
  await page.locator('[data-command="snippets"]').first().click();
  await page.locator('#new-snippet').click();
  await page.locator('[name="name"]').fill('Test gamma');
  await page.locator('[name="trigger"]').fill('g/');
  await page.locator('[name="replacement"]').fill('\\gamma$0');
  await page.getByRole('button', { name: 'Save snippet', exact: true }).click();
  await expect(page.locator('#snippet-list')).toContainText('Test gamma');
  await page.locator('#dialog-close').click();
  await replace(page, '$');
  await page.keyboard.type('g/');
  await expect(page.locator('.cm-content')).toHaveText('$\\gamma$');
  await page.keyboard.press('Control+s');
  await expect(page.locator('#save-status')).toHaveText('All changes saved');
  await page.reload();
  await page.locator('[data-command="snippets"]').first().click();
  await expect(page.locator('#snippet-list')).toContainText('Test gamma');
});
test('Alt+F moves between outer fraction arguments', async ({ page }) => {
  await replace(page, '$\\frac{abc}{def}$');
  await page.keyboard.press('Control+Home');
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Alt+f');
  await page.keyboard.type('X');
  await expect(page.locator('.cm-content')).toHaveText('$\\frac{abc}{Xdef}$');
});

test('Alt+D enters a nested exponent before leaving the numerator', async ({ page }) => {
  const text = String.raw`\frac{3x^{2}}{1}`;
  await replace(page, text);
  await page.keyboard.press('Control+Home');
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
  for (const column of [11, 13, 15, 17]) {
    await page.keyboard.press('Alt+d');
    await expect(page.locator('#position')).toHaveText(`Ln 1, Col ${column}`);
  }
  await expect(page.locator('.cm-content')).toHaveText(text);
});

test('Alt+S moves from denominator content to numerator without changing text', async ({
  page,
}) => {
  const text = String.raw`\frac{3x^2}{1 }`;
  await replace(page, text);
  await page.keyboard.press('Control+End');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Alt+s');
  await expect(page.locator('#position')).toHaveText('Ln 1, Col 7');
  await expect(page.locator('.cm-content')).toHaveText(text);
});

test('Alt+S reverses Alt+D through nested fraction stops', async ({ page }) => {
  const text = String.raw`\frac{3x^{2}}{1}`;
  await replace(page, text);
  await page.keyboard.press('Control+End');
  for (const column of [15, 13, 11, 7]) {
    await page.keyboard.press('Alt+s');
    await expect(page.locator('#position')).toHaveText(`Ln 1, Col ${column}`);
  }
  for (const column of [11, 13, 15, 17]) {
    await page.keyboard.press('Alt+d');
    await expect(page.locator('#position')).toHaveText(`Ln 1, Col ${column}`);
  }
  await expect(page.locator('.cm-content')).toHaveText(text);
});

test('appearance previews, cancels and persists custom color roles', async ({ page }) => {
  await page.locator('[data-command="settings"]').first().click();
  await page.locator('[data-settings="appearance"]').click();
  await page.getByLabel('Interface accent hex', { exact: true }).fill('#ee99cc');
  await expect(page.locator('html')).toHaveCSS('--accent', '#ee99cc');
  await page.locator('#dialog-close').click();
  await expect(page.locator('html')).toHaveCSS('--accent', '#9daeff');
  await page.locator('[data-command="settings"]').first().click();
  await page.locator('[data-settings="appearance"]').click();
  await page.getByLabel('Interface accent hex', { exact: true }).fill('#88ccaa');
  await page.getByLabel('Cursor hex', { exact: true }).fill('#abcdef');
  await page.getByLabel('Commands hex', { exact: true }).fill('#ddaaee');
  await page.getByRole('button', { name: 'Save appearance', exact: true }).click();
  await expect(page.locator('#toast')).toHaveText('Appearance saved');
  await page.screenshot({ path: 'docs/appearance-dark.png' });
  await page.reload();
  await expect(page.locator('html')).toHaveCSS('--accent', '#88ccaa');
  await expect(page.locator('html')).toHaveCSS('--cursor', '#abcdef');
  await expect(page.locator('html')).toHaveCSS('--syntax-command', '#ddaaee');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.sidebar-bottom, .writing-hint')).toHaveCount(0);
});

for (const surface of ['main', 'practice'] as const) {
  test(`${surface}: outer argument, term and line shortcuts follow the requested stops`, async ({
    page,
  }) => {
    if (surface === 'practice') {
      await page.locator('[data-command="practice"]').click();
      await expect(page.locator('#practice-target svg').first()).toBeVisible();
    }
    const input = page.locator(
      surface === 'practice' ? '#practice-editor .cm-content' : '#editor .cm-content',
    );
    const cases = [
      [
        String.raw`$\frac{3x^{2x^{|2}}}{3x^{2}}$`,
        'Alt+f',
        String.raw`$\frac{3x^{2x^{2}}}{!3x^{2}}$`,
      ],
      [
        String.raw`$\frac{3x^{2x^{2}}}{3x^{|2}}$`,
        'Alt+a',
        String.raw`$\frac{!3x^{2x^{2}}}{3x^{2}}$`,
      ],
      ['|3x+5x', 'Alt+e', '3x!+5x'],
      ['3x|+5x', 'Alt+e', '3x+!5x'],
      ['3x+5x|', 'Alt+w', '3x+!5x'],
      ['3x+|5x', 'Alt+w', '3x!+5x'],
      [String.raw`3x| \cdot 5x`, 'Alt+e', String.raw`3x !\cdot 5x`],
      ['first\n  sec|ond\nlast', 'Alt+q', 'first\n!  second\nlast'],
      ['first\n  sec|ond\nlast', 'Alt+r', 'first\n  second!\nlast'],
    ];
    for (const [marked, key, expected] of cases) {
      await input.click();
      await page.keyboard.press('Control+a');
      await page.keyboard.insertText(marked.replace('|', ''));
      await page.keyboard.press('Control+Home');
      for (let n = 0; n < marked.indexOf('|'); n++) await page.keyboard.press('ArrowRight');
      await page.keyboard.press(key);
      await page.keyboard.insertText('!');
      await expect(input).toHaveText(expected.replace(/\n/g, ''));
    }
  });
}
