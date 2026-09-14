import { test, expect } from '@playwright/test';

test('soft wrapping defaults on, toggles both editors and textareas, and persists', async ({
  page,
}) => {
  await page.goto('/');
  const input = page.locator('#editor .cm-content');
  await expect(input).toContainText('documentclass');
  await expect(input).toHaveClass(/cm-lineWrapping/);
  const text = 'long_expression_'.repeat(100);
  await input.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(text);
  await expect(input).toHaveText(text);
  const wrappedHeight = await input
    .locator('.cm-line')
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(wrappedHeight).toBeGreaterThan(60);
  await page.locator('[data-command="settings"]').first().click();
  await expect(page.getByLabel('Wrap long lines')).toBeChecked();
  const textarea = page.locator('[name="termSeparators"]');
  await expect(textarea).toHaveCSS('white-space', 'pre-wrap');
  await page.getByLabel('Wrap long lines').uncheck();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.locator('#toast')).toHaveText('Settings saved');
  await expect(textarea).toHaveCSS('white-space', 'pre');
  await expect(input).not.toHaveClass(/cm-lineWrapping/);
  await expect(input).toHaveText(text);
  await page.locator('#dialog-close').click();
  expect(
    await input.locator('.cm-line').evaluate((el) => el.getBoundingClientRect().height),
  ).toBeLessThan(wrappedHeight);
  await page.locator('[data-command="practice"]').click();
  await expect(page.locator('#practice-editor .cm-content')).not.toHaveClass(/cm-lineWrapping/);
  await page.locator('#practice-close').click();
  await page.reload();
  await page.getByRole('button', { name: 'Recover files' }).click();
  await expect(input).not.toHaveClass(/cm-lineWrapping/);
  await page.locator('[data-command="settings"]').first().click();
  await expect(page.getByLabel('Wrap long lines')).not.toBeChecked();
  await page.getByLabel('Wrap long lines').check();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(input).toHaveClass(/cm-lineWrapping/);
  await page.locator('#dialog-close').click();
  await page.locator('[data-command="practice"]').click();
  await expect(page.locator('#practice-editor .cm-content')).toHaveClass(/cm-lineWrapping/);
});
