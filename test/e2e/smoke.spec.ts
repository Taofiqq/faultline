import { test, expect } from '@playwright/test';

test.describe('Application smoke test', () => {
  test('app loads successfully', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        // Filter React dev warnings that are acceptable
        if (!msg.text().includes('Download the React DevTools')) {
          errors.push(msg.text());
        }
      }
    });

    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('Faultline');
    await expect(page.getByLabel('Topology editor')).toBeVisible();
    await expect(page.getByLabel('Run simulation')).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test('topology workspace is visible and interactive', async ({ page }) => {
    await page.goto('/');
    const canvas = page.getByLabel('Topology editor');
    await expect(canvas).toBeVisible();

    // Add Service button is accessible
    const addBtn = page.getByLabel('Add service');
    await expect(addBtn).toBeVisible();
  });

  test('no unhandled page errors during basic interaction', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    // Click Add Service
    await page.getByLabel('Add service').click();
    // Wait a tick
    await page.waitForTimeout(100);
    expect(errors).toHaveLength(0);
  });
});
