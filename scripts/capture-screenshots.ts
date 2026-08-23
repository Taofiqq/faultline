/**
 * Capture payment demo screenshots for documentation.
 * Run: npx playwright test scripts/capture-screenshots.ts --project=chromium
 */
import { test, expect } from '@playwright/test';

test('capture payment demo screenshots', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  // Screenshot 1: Load the demo
  await page.getByRole('button', { name: /load payment demo/i }).click();
  await expect(page.getByLabel('Random seed')).toHaveValue('0');
  await page.waitForTimeout(500); // let animations settle
  await page.screenshot({
    path: 'docs/screenshots/01-baseline-scenario.png',
    fullPage: false,
  });

  // Screenshot 2: Run baseline — invariant fails (double charge)
  await page.getByLabel('Run simulation').click();
  await expect(page.getByRole('tablist', { name: 'Results views' })).toBeVisible();
  await page.getByRole('tab', { name: 'Invariants' }).click();
  await expect(page.locator('.invariant-result--fail')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({
    path: 'docs/screenshots/02-invariant-failure.png',
    fullPage: false,
  });

  // Screenshot 3: Enable idempotency — invariant passes
  await page.getByRole('button', { name: /enable idempotency/i }).click();
  await expect(page.getByRole('tablist', { name: 'Results views' })).toBeVisible();
  await page.getByRole('tab', { name: 'Invariants' }).click();
  await expect(page.locator('.invariant-result--pass')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({
    path: 'docs/screenshots/03-idempotent-pass.png',
    fullPage: false,
  });
});
