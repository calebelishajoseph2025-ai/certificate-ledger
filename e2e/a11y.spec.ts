import {expect, test} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('home has no serious axe violations', async ({page}) => {
  await page.goto('/');
  const results = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
});
