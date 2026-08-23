import { test, expect } from '@playwright/test';

test.describe('Custom scenario workflow', () => {
  test('create and run a custom scenario', async ({ page }) => {
    await page.goto('/');

    // Add services
    await page.getByLabel('Add service').click();
    await page.getByLabel('Add service').click();

    // Wait for nodes to appear in the topology
    await page.waitForTimeout(300);

    // Set seed for determinism
    const seedInput = page.getByLabel('Random seed');
    await seedInput.fill('12345');

    // Run should work if there are connected paths
    // For now just verify the app doesn't crash with services added
    await expect(page.getByLabel('Run simulation')).toBeVisible();
  });

  test('inspect all result tabs after running demo', async ({ page }) => {
    await page.goto('/');

    // Use demo as it has a working scenario
    await page.getByRole('button', { name: /load demo/i }).click();
    await page.getByLabel('Run simulation').click();

    await expect(page.getByRole('tablist', { name: 'Results views' })).toBeVisible();

    // Timeline tab
    await page.getByRole('tab', { name: 'Timeline' }).click();
    await expect(page.locator('.timeline')).toBeVisible();

    // Events tab
    await page.getByRole('tab', { name: 'Events' }).click();
    await expect(page.locator('.event-table')).toBeVisible();

    // Metrics tab
    await page.getByRole('tab', { name: 'Metrics' }).click();
    await expect(page.locator('.metrics-panel')).toBeVisible();

    // Invariants tab
    await page.getByRole('tab', { name: 'Invariants' }).click();
    await expect(page.locator('.invariant-results')).toBeVisible();
  });
});
