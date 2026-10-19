import { expect, test } from '@playwright/test';
import { startSolo } from './helpers';

test('mobile bottom sheet switches tabs', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) >= 900, 'mobile only');
  await startSolo(page);
  for (const tab of ['Forces', 'Objectives', 'Ask', 'Brief']) {
    await page.getByRole('tab', { name: tab }).click();
    await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
  }
  await page.getByRole('tab', { name: 'Forces' }).click();
  await expect(page.getByRole('button', { name: /^Air:/ })).toBeVisible();
  await page.getByRole('tab', { name: 'Objectives' }).click();
  await expect(page.getByRole('button', { name: /Panama Canal/ })).toBeVisible();
});
