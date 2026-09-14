import { test, expect } from '@playwright/test';

test('prose spelling, suggestions, ignores, scoped dictionaries and file toggle', async ({
  page,
}) => {
  await page.goto('/');
  const input = page.locator('#editor .cm-content');
  await expect(input).toContainText('documentclass');
  const command = async (name: string) => {
    await page.keyboard.press('Control+Shift+p');
    await page.locator('#palette-query').fill(name);
    await page.keyboard.press('Enter');
  };
  await input.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(
    String.raw`This is mispelled. $mathfake$ \label{labelfake} \cite{citefake} % commentfake`,
  );
  const errors = page.locator('#editor .cm-spelling-error');
  await expect(errors).toHaveText(['mispelled'], { timeout: 15000 });
  await command('Next spelling issue');
  await command('Spelling suggestions');
  await page.getByRole('button', { name: 'misspelled', exact: true }).click();
  await expect(errors).toHaveCount(0);
  await expect(input).toContainText('This is misspelled.');
  await page.keyboard.press('Control+z');
  await expect(errors).toHaveText(['mispelled']);
  await command('Next spelling issue');
  await command('Spelling suggestions');
  await page.getByRole('button', { name: 'Ignore for session' }).click();
  await expect(errors).toHaveCount(0);
  await input.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('Quillwords');
  await expect(errors).toHaveText(['Quillwords']);
  await command('Next spelling issue');
  await command('Spelling suggestions');
  await page.getByRole('button', { name: 'Add to project dictionary' }).click();
  await expect(errors).toHaveCount(0);
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('quill.dictionary.project') || '[]')),
  ).toContain('quillwords');
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('quill.dictionary.global') || '[]')),
  ).not.toContain('quillwords');
  await input.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('anotherrword');
  await expect(errors).toHaveText(['anotherrword']);
  await command('Toggle spell checking for current file');
  await expect(errors).toHaveCount(0);
  await command('Toggle spell checking for current file');
  await expect(errors).toHaveText(['anotherrword']);
});

for (const surface of ['main', 'practice']) {
  test(`${surface}: compact spelling dropdown supports keyboard and right-click`, async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('#editor .cm-content')).toContainText('documentclass');
    if (surface === 'practice') {
      await page.locator('[data-command="practice"]').click();
      await expect(page.locator('#practice-target svg').first()).toBeVisible();
    }
    const input = page.locator(
      surface === 'main' ? '#editor .cm-content' : '#practice-editor .cm-content',
    );
    await input.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(String.raw`\text{This is mispelled.}`);
    const mistake = input.locator('.cm-spelling-error');
    await expect(mistake).toHaveText('mispelled');
    await page.keyboard.press('F7');
    await page.keyboard.press('Shift+F7');
    const menu = page.getByRole('group', { name: 'Spelling suggestions' });
    await expect(menu).toBeVisible();
    await expect(page.locator('#dialog')).not.toBeVisible();
    const wordBox = await mistake.boundingBox(),
      menuBox = await menu.boundingBox();
    expect(Math.abs(menuBox!.x - wordBox!.x)).toBeLessThan(300);
    expect(menuBox!.width).toBeLessThanOrEqual(300);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Home');
    await expect(menu.locator('button').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(input).toBeFocused();
    const box = (await mistake.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: 'right' });
    await expect(menu).toBeVisible();
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(150);
    await expect(menu).toBeVisible();
    await page.screenshot({ path: `docs/spelling-menu-${surface}.png` });
    await menu.getByRole('button', { name: 'misspelled', exact: true }).click();
    await expect(menu).toHaveCount(0);
    await expect(input).toContainText('misspelled');
    await page.keyboard.press('Control+z');
    await expect(mistake).toHaveText('mispelled');
    await mistake.click({ button: 'right' });
    await expect(menu).toBeVisible();
    await input.click({ position: { x: 3, y: 3 } });
    await expect(menu).toHaveCount(0);
  });
}
