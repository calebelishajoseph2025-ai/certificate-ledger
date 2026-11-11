import {expect, test} from '@playwright/test';

test('home and verify routes render', async ({page}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', {level: 1})).toBeVisible();
  await page.goto('/verify');
  await expect(page.getByRole('heading', {level: 1})).toBeVisible();
  await page.locator('input').first().fill('CL-26-NOTREAL0');
  await page.getByRole('button', {name: /look up/i}).click();
  await expect(page.getByRole('heading', {name: /not well-formed|no record|valid|revoked/i})).toBeVisible({
    timeout: 15_000,
  });
});

test('command palette opens with shortcut', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: /command palette/i}).click();
  await expect(page.getByPlaceholder(/jump to a page/i)).toBeVisible();
});
