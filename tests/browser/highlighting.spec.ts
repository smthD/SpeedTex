import { test, expect } from '@playwright/test';
for (const surface of ['main', 'practice'])
  test(`${surface}: LaTeX matching, errors, presets and disable`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#editor .cm-content')).toContainText('documentclass');
    if (surface === 'practice') {
      await page.locator('[data-command="practice"]').click();
      await expect(page.locator('#practice-target svg').first()).toBeVisible();
    }
    const input = page.locator(
      surface === 'main' ? '#editor .cm-content' : '#practice-editor .cm-content',
    );
    const text = String.raw`\[\frac{\left(x^{2}\right)}{\sqrt{y}}\]`;
    await input.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(text);
    await page.keyboard.press('Control+Home');
    for (let n = 0; n < text.indexOf('2'); n++) await page.keyboard.press('ArrowRight');
    await expect(input.locator('.cm-latex-active')).toHaveCount(2);
    const colors = await input
      .locator('.cm-latex-active')
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).color));
    expect(colors[0]).toBe(colors[1]);
    await expect(input.locator('.cm-latex-unmatched')).toHaveCount(0);
    await expect(input.locator('.cm-latex-delimiter').filter({ hasText: '\\left(' })).toHaveCount(
      1,
    );
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(' }');
    await expect(input.locator('.cm-latex-unmatched')).toHaveCount(1);
    await page.keyboard.press('Control+z');
    await expect(input.locator('.cm-latex-unmatched')).toHaveCount(0);
    if (surface === 'practice') await page.locator('#practice-close').click();
    await page.locator('[data-command="settings"]').first().click();
    await page.locator('[data-settings="highlighting"]').click();
    await page.getByRole('button', { name: 'Focus', exact: true }).click();
    await page.getByRole('button', { name: 'Save highlighting', exact: true }).click();
    await expect(page.locator('#toast')).toHaveText('Highlighting saved');
    await page.locator('#dialog-close').click();
    if (surface === 'practice') {
      await page.locator('[data-command="practice"]').click();
      await expect(page.locator('#practice-target svg').first()).toBeVisible();
      await input.click();
      await page.keyboard.press('Control+a');
      await page.keyboard.insertText(text);
    }
    await input.click();
    await page.keyboard.press('Control+Home');
    for (let n = 0; n < text.indexOf('2'); n++) await page.keyboard.press('ArrowRight');
    await expect(input.locator('.cm-latex-active')).toHaveCount(2);
    await expect(input.locator('.cm-latex-fill')).toHaveCount(2);
    await expect(input.locator('.cm-latex-scope')).toHaveCount(1);
    await page.screenshot({ path: `docs/highlighting-${surface}.png` });
    if (surface === 'practice') await page.locator('#practice-close').click();
    await page.locator('[data-command="settings"]').first().click();
    await page.locator('[data-settings="highlighting"]').click();
    await page.getByLabel('Enable delimiter highlighting').uncheck();
    await page.getByRole('button', { name: 'Save highlighting' }).click();
    await page.locator('#dialog-close').click();
    await expect(page.locator('#editor .cm-latex-delimiter')).toHaveCount(0);
  });
