import { expect, type Page } from '@playwright/test';

export const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 900;

/** Count non-background pixels on the map canvas to prove it actually rendered. */
export async function canvasHasContent(page: Page) {
  return page.evaluate(() => {
    const c = document.querySelector('.map canvas') as HTMLCanvasElement | null;
    if (!c) return 0;
    const ctx = c.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4 * 97) seen.add((data[i] >> 3) * 1024 + (data[i + 1] >> 3) * 32 + (data[i + 2] >> 3));
    return seen.size;
  });
}

export async function startSolo(page: Page, opts: { tour?: boolean } = {}) {
  await page.goto('/');
  await page.getByRole('button', { name: /TAKE COMMAND/ }).click();
  await expect(page.getByRole('dialog', { name: 'Mission briefing' })).toBeVisible();
  if (opts.tour) await page.getByRole('button', { name: 'Tour the war room' }).click();
  else await page.getByRole('button', { name: 'BEGIN OPERATION' }).click();
}

export async function camera(page: Page) {
  return page.evaluate(() => {
    const c = (window as unknown as { __wr: { camera: { cx: number; cy: number; s: number } } }).__wr.camera;
    return { cx: c.cx, cy: c.cy, s: c.s };
  });
}
