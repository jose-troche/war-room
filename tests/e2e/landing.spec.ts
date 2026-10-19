import { expect, test } from '@playwright/test';
import { canvasHasContent } from './helpers';

test('landing shows the live map, not just text', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /WAR ROOM/ })).toBeVisible();
  await expect(page.getByText('LIVE · AI vs AI simulation')).toBeVisible();
  await page.waitForTimeout(1500);
  expect(await canvasHasContent(page)).toBeGreaterThan(30);
  await expect(page.getByRole('radio', { name: /Veteran/ })).toHaveAttribute('aria-checked', 'true');
  expect(errors).toEqual([]);
});

test('how to play explains the objectives', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'How to play' }).click();
  const dlg = page.getByRole('dialog', { name: 'How to play' });
  await expect(dlg.getByText('CONTROL THE CHOKEPOINTS')).toBeVisible();
  await expect(dlg.getByText('TRUST YOUR STAFF')).toBeVisible();
  await dlg.getByRole('button', { name: 'Got it' }).click();
  await expect(dlg).toBeHidden();
});
