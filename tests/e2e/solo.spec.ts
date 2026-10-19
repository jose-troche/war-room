import { expect, test } from '@playwright/test';
import { camera, isMobile, startSolo } from './helpers';

test('briefing states objectives, then ATLAS opens with actionable orders', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /TAKE COMMAND/ }).click();
  const brief = page.getByRole('dialog', { name: 'Mission briefing' });
  await expect(brief.getByText(/First to/)).toBeVisible();
  await expect(brief.getByText('CONTROL THE CHOKEPOINTS')).toBeVisible();
  await brief.getByRole('button', { name: 'BEGIN OPERATION' }).click();
  await expect(page.getByText(/Opening orders/)).toBeVisible({ timeout: 10_000 });
  // one-click recommended action issues an order
  await page.getByRole('button', { name: /^Send .* ETA/ }).first().click();
  await expect(page.locator('.toast')).toContainText(/→/);
});

test('fit all reframes the camera', async ({ page }) => {
  await startSolo(page);
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: '+' }).or(page.getByRole('button', { name: 'Zoom in (+)' })).first().click();
  await page.getByRole('button', { name: 'Zoom in (+)' }).click();
  const zoomed = await camera(page);
  await page.getByRole('button', { name: 'Fit all relevant assets' }).click();
  await page.waitForTimeout(900);
  const fitted = await camera(page);
  expect(fitted.s).toBeLessThan(zoomed.s);
});

test('drill down from force status to a unit and order it', async ({ page }) => {
  await startSolo(page);
  if (isMobile(page)) await page.getByRole('tab', { name: 'Forces' }).click();
  await page.getByRole('button', { name: /^Sea:/ }).click();
  await page.getByRole('button', { name: /DDG LANCE/ }).first().click();
  await expect(page.getByRole('heading', { name: 'DDG LANCE' })).toBeVisible();
  await expect(page.getByText('Weapon range')).toBeVisible();
  // targets/move: issue a hold then move via map click
  const map = page.locator('.map');
  const box = (await map.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * (isMobile(page) ? 0.3 : 0.42));
  await expect(page.locator('.toast')).toContainText(/DDG LANCE/);
});

test('Ask ATLAS answers in plain language and highlights units', async ({ page }) => {
  await startSolo(page);
  if (isMobile(page)) await page.getByRole('tab', { name: 'Ask' }).click();
  const input = page.getByRole('textbox', { name: /Ask ATLAS/ });
  await input.fill('where are my destroyers?');
  await input.press('Enter');
  await expect(page.locator('.ask-answer')).toContainText(/our destroyers/);
  await input.fill('send destroyers to Gibraltar');
  await input.press('Enter');
  await expect(page.locator('.ask-answer')).toContainText(/Gibraltar/);
  await page.locator('.ask-answer').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.locator('.ask-answer')).toContainText('Ordered');
});

test('staff traffic shows the raw firehose', async ({ page }) => {
  await startSolo(page);
  await page.waitForTimeout(6000);
  if (isMobile(page)) await page.getByRole('tab', { name: 'Brief' }).click();
  await page.getByRole('button', { name: /reports → surfaced/ }).first().click();
  const drawer = page.getByRole('complementary', { name: 'Raw staff traffic' });
  await expect(drawer).toBeVisible();
  expect(await drawer.locator('.r').count()).toBeGreaterThan(5);
  await drawer.getByRole('button', { name: 'Close' }).click();
});

test('guided tour walks through every panel', async ({ page }) => {
  await startSolo(page, { tour: true });
  for (let i = 0; i < 7; i++) {
    await expect(page.locator('.tour-tip')).toBeVisible();
    await page.locator('.tour-tip').getByRole('button', { name: 'Next' }).click();
  }
  await page.locator('.tour-tip').getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.tour-tip')).toBeHidden();
  // tour completion starts the clock
  const t0 = await page.evaluate(() => (window as unknown as { __wr: { view: { value: { t: number } } } }).__wr.view.value.t);
  await page.waitForTimeout(1500);
  const t1 = await page.evaluate(() => (window as unknown as { __wr: { view: { value: { t: number } } } }).__wr.view.value.t);
  expect(t1).toBeGreaterThan(t0);
});

test('after-action report appears when the match ends', async ({ page }) => {
  await startSolo(page);
  await page.evaluate(() => (window as unknown as { __wr: { session: () => { engine: { forfeit: (s: string) => void } } } }).__wr.session().engine.forfeit('red'));
  const aar = page.getByRole('dialog', { name: 'After-action report' });
  await expect(aar).toBeVisible({ timeout: 5000 });
  await expect(aar.getByText('VICTORY')).toBeVisible();
  await expect(aar.getByRole('button', { name: /Share result/ })).toBeVisible();
  await aar.getByRole('button', { name: 'Rematch' }).click();
  await expect(page.getByRole('dialog', { name: 'Mission briefing' })).toBeVisible();
});
