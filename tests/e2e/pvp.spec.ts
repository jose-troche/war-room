import { expect, test } from '@playwright/test';

test('two humans can play in a room', async ({ browser, page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) < 900, 'desktop only');
  await page.goto('/');
  await page.getByRole('button', { name: /Play vs a human/ }).click();
  await page.getByRole('button', { name: 'CREATE ROOM' }).click();
  const lobby = page.getByRole('dialog', { name: 'Multiplayer lobby' });
  await expect(lobby).toBeVisible();
  const link = await lobby.getByRole('textbox').inputValue();
  expect(link).toMatch(/\?room=[A-Z0-9]{5}$/);

  const guestCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const guest = await guestCtx.newPage();
  await guest.goto(link);
  await expect(guest.getByRole('dialog', { name: 'Multiplayer lobby' })).toContainText('HYDRA');
  await expect(lobby).toContainText('2/2');
  await lobby.getByRole('button', { name: 'START MATCH' }).click();

  for (const p of [page, guest]) {
    const brief = p.getByRole('dialog', { name: 'Mission briefing' });
    await expect(brief).toBeVisible({ timeout: 10_000 });
    await brief.getByRole('button', { name: 'BEGIN OPERATION' }).click();
  }
  await expect(page.locator('.topbar')).toBeVisible();
  const side = await guest.evaluate(() => (window as unknown as { __wr: { view: { value: { side: string } } } }).__wr.view.value.side);
  expect(side).toBe('red');
  await guestCtx.close();
});
