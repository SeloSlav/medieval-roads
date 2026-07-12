import { expect, test } from '@playwright/test';

const STARTING_TIMBER = 160;
const REFORESTER_TIMBER_COST = 35;
const STARTUP_TIMEOUT_MS = 90_000;
const SYNC_TIMEOUT_MS = 45_000;

test('connects, places a reforester, and updates settlement HUD timber', async ({ page }) => {
  await page.goto('/');

  const timberHud = page.locator('[data-stockpile="timber"]');
  await expect(timberHud).toHaveText(String(STARTING_TIMBER), { timeout: STARTUP_TIMEOUT_MS });

  await page.keyboard.press('v');
  await page.keyboard.press('f');
  await page.waitForFunction(() => window.__medievalE2e?.getBuildingMode() === 'reforester');

  const timberBefore = Number(await timberHud.textContent());
  expect(timberBefore).toBe(STARTING_TIMBER);

  await page.evaluate(async () => {
    await window.__medievalE2e!.placeRforesterAtFirstValidSpot();
  });

  await expect(timberHud).toHaveText(String(timberBefore - REFORESTER_TIMBER_COST), { timeout: SYNC_TIMEOUT_MS });
  await page.waitForFunction(() => (window.__medievalE2e?.getBuildingCount() ?? 0) >= 1);
});

declare global {
  interface Window {
    __medievalE2e?: {
      isConnected: () => boolean;
      getBuildingMode: () => string;
      getHudTimber: () => string;
      getBuildingCount: () => number;
      placeRforesterAtFirstValidSpot: () => Promise<{ x: number; z: number }>;
    };
  }
}
