import {expect, test} from '@playwright/test';

test('failed organizer sign-in surfaces an error', async ({page}) => {
  await page.goto('/login');
  await page.getByLabel(/organizer secret/i).fill('not-the-secret');
  await page.getByRole('button', {name: /sign in/i}).click();
  await expect(page.getByRole('alert')).toBeVisible();
});
