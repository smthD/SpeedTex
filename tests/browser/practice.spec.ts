import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#editor .cm-content')).toContainText('documentclass');
  await page.locator('[data-command="practice"]').click();
  await expect(page.locator('#practice-target svg').first()).toBeVisible();
});
test('practice renders white math and shares snippets, structural movement and completion', async ({
  page,
}) => {
  const source = await page.locator('#editor .cm-content').textContent();
  const input = page.locator('#practice-editor .cm-content');
  await input.click();
  await page.keyboard.type('fr/');
  await expect(input).toContainText('\\frac{}{}');
  await page.keyboard.type('sq/');
  await page.keyboard.type('x');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.type('y');
  await expect(input).toContainText('\\frac{\\sqrt{x}}{y}');
  await expect(page.locator('#practice-output svg').first()).toBeVisible();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('\\[\\frac{3x^{2}}{1}\\]');
  await page.keyboard.press('Control+Home');
  for (let n = 0; n < 8; n++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Alt+d');
  await page.keyboard.insertText('a');
  await expect(input).toContainText('\\frac{3x^{a2}}{1}');
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('\\[\\pd');
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('\\pdv');
  await page.screenshot({ path: 'docs/practice-dark.png' });
  await page.locator('#practice-close').click();
  await expect(page.locator('#editor .cm-content')).toHaveText(source!);
});
test('source hints are unranked, new prompts differ, and physics renders', async ({ page }) => {
  await page.locator('#practice-reveal').click();
  const tex = await page.locator('#practice-source').innerText();
  await page.locator('#practice-editor .cm-content').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('\\[' + tex + '\\]');
  await expect(page.locator('#practice-result')).toContainText('Matched · unranked');
  await expect(page.locator('#practice-best')).toHaveText('—');
  await page.locator('#practice-next').click();
  await expect(page.locator('#practice-target svg').first()).toBeVisible();
  await page.locator('#practice-reveal').click();
  expect(await page.locator('#practice-source').innerText()).not.toBe(tex);
  await page.locator('#practice-style').selectOption('mathematics');
  await page.locator('#practice-difficulty').selectOption('extended');
  await expect(page.locator('#practice-target svg').first()).toBeVisible();
  await expect(page.locator('#practice-target')).toHaveCSS('color', 'rgb(255, 255, 255)');
  await page.screenshot({ path: 'docs/practice-dark.png' });
});
test('ranked output speed persists across reopening and reload', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.23;
  });
  await page.reload();
  await page.locator('[data-command="practice"]').click();
  await expect(page.locator('#practice-target svg').first()).toBeVisible();
  await page.locator('#practice-reveal').click();
  const tex = await page.locator('#practice-source').innerText();
  // A fresh session reproduces the seeded prompt without using a hint.
  await page.reload();
  await page.locator('[data-command="practice"]').click();
  await expect(page.locator('#practice-target svg').first()).toBeVisible();
  await page.locator('#practice-editor .cm-content').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('\\[');
  await page.waitForTimeout(1100);
  await page.keyboard.insertText(tex + '\\]');
  await expect(page.locator('#practice-result')).toContainText('chars/min');
  const best = await page.locator('#practice-best').innerText();
  expect(Number(best)).toBeGreaterThan(0);
  await page.reload();
  await page.locator('[data-command="practice"]').click();
  await expect(page.locator('#practice-target svg').first()).toBeVisible();
  await expect(page.locator('#practice-best')).toHaveText(best);
});
