import { test, expect } from '@playwright/test';
for (const surface of ['main', 'practice']) {
  test(`${surface}: term selection, cuts, paste and undo`, async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
    await expect(page.locator('#editor .cm-content')).toContainText('documentclass');
    if (surface === 'practice') {
      await page.locator('[data-command="practice"]').click();
      await expect(page.locator('#practice-target svg').first()).toBeVisible();
    }
    const input = page.locator(
      surface === 'main' ? '#editor .cm-content' : '#practice-editor .cm-content',
    );
    const put = async (text: string) => {
      await input.click();
      await page.keyboard.press('Control+a');
      await page.keyboard.insertText(text);
    };
    const clip = () => page.evaluate(() => navigator.clipboard.readText());
    await put('3x+5x');
    await page.keyboard.press('Alt+p');
    expect(await page.evaluate(() => getSelection()?.toString())).toBe('5x');
    await page.keyboard.press('Alt+p');
    expect(await page.evaluate(() => getSelection()?.toString())).toBe('3x+5x');
    await page.keyboard.press('Alt+o');
    await expect(input).toHaveText('');
    expect(await clip()).toBe('3x+5x');
    await page.keyboard.press('Alt+l');
    await expect(input).toHaveText('3x+5x');
    await page.keyboard.press('Alt+o');
    await expect(input).toHaveText('3x+');
    expect(await clip()).toBe('5x');
    await page.keyboard.press('Control+z');
    await expect(input).toHaveText('3x+5x');
    await put('\\frac{3x+1}{2}');
    await page.keyboard.press('Control+Home');
    for (let n = 0; n < 9; n++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Alt+i');
    await expect(input).toHaveText('\\frac{}{2}');
    expect(await clip()).toBe('3x+1');
    await page.keyboard.press('Alt+l');
    await expect(input).toHaveText('\\frac{3x+1}{2}');
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('Alt+i');
    await expect(input).toHaveText('\\frac{3x+1}{2}');
    expect(await clip()).toBe('3x+1');
  });
}
test('failed clipboard writes never delete source', async ({ page }) => {
  await page.goto('/');
  const input = page.locator('#editor .cm-content');
  await expect(input).toContainText('documentclass');
  await input.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('3x+5x');
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async () => {
          throw Error('Clipboard denied');
        },
      },
      configurable: true,
    }),
  );
  await page.keyboard.press('Alt+o');
  await expect(page.locator('#toast')).toContainText('Clipboard denied');
  await expect(input).toHaveText('3x+5x');
});

for (const surface of ['main', 'practice']) {
  test(`${surface}: delimiter term movement and editable boundaries`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#editor .cm-content')).toContainText('documentclass');
    const openSurface = async () => {
      if (surface === 'practice') {
        await page.locator('[data-command="practice"]').click();
        await expect(page.locator('#practice-target svg').first()).toBeVisible();
      }
    };
    await openSurface();
    const input = page.locator(
      surface === 'main' ? '#editor .cm-content' : '#practice-editor .cm-content',
    );
    const move = async (before: string, key: string, after: string) => {
      const pos = before.indexOf('|');
      await input.click();
      await page.keyboard.press('Control+a');
      await page.keyboard.insertText(before.replace('|', ''));
      await page.keyboard.press('Control+Home');
      for (let i = 0; i < pos; i++) await page.keyboard.press('ArrowRight');
      await page.keyboard.press(key);
      await page.keyboard.insertText('|');
      await expect(input).toHaveText(after);
    };
    await move('$5x|+3$', 'Alt+w', '$|5x+3$');
    await move('3x^2|+x', 'Alt+e', '3x^2+|x');
    await move('3x^2|++x', 'Alt+e', '3x^2+|+x');
    await move('3x^2+|+x', 'Alt+e', '3x^2++|x');
    await move('3x^2++|x', 'Alt+w', '3x^2+|+x');
    await move('3x^2+|+x', 'Alt+w', '3x^2|++x');

    await move(String.raw`3|\left(x^2\right)`, 'Alt+e', String.raw`3\left(|x^2\right)`);
    await move(String.raw`\[5x|+3\]`, 'Alt+w', String.raw`\[|5x+3\]`);
    if (surface === 'practice') await page.locator('#practice-close').click();
    await page.locator('[data-command="settings"]').first().click();
    await page.locator('[name="termSeparators"]').fill('=\n<=');
    await page.locator('[name="termWhitespace"]').uncheck();
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.locator('#toast')).toHaveText('Settings saved');
    await page.locator('#dialog-close').click();
    await openSurface();
    await move('|a+b = c', 'Alt+e', 'a+b |= c');
    if (surface === 'practice') await page.locator('#practice-close').click();
    await page.reload();
    if (surface === 'main') await page.getByRole('button', { name: 'Recover files' }).click();
    await page.locator('[data-command="settings"]').first().click();
    await expect(page.locator('[name="termSeparators"]')).toHaveValue('=\n<=');
    await expect(page.locator('[name="termWhitespace"]')).not.toBeChecked();
  });
}
