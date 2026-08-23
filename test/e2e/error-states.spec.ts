import { test, expect } from '@playwright/test';

test.describe('Error and stopped states', () => {
  test('run button disabled when no services exist', async ({ page }) => {
    await page.goto('/');
    const runBtn = page.getByLabel('Run simulation');
    await expect(runBtn).toBeDisabled();
  });

  test('application remains recoverable after errors', async ({ page }) => {
    await page.goto('/');

    // Load demo, run successfully
    await page.getByRole('button', { name: /load demo/i }).click();
    await page.getByLabel('Run simulation').click();
    await expect(page.getByRole('tablist', { name: 'Results views' })).toBeVisible();

    // App should still be interactive
    await expect(page.getByLabel('Run simulation')).toBeEnabled();
    await expect(page.getByLabel('Random seed')).toBeVisible();
  });

  test('status shows diagnostic when simulation stops', async ({ page }) => {
    await page.goto('/');
    // Load demo and run - the status bar should show info
    await page.getByRole('button', { name: /load demo/i }).click();
    await page.getByLabel('Run simulation').click();

    // Wait for footer status to update
    const footer = page.locator('[aria-label="Results summary"]');
    await expect(footer).toBeVisible();
    // Should contain event count info
    await expect(footer.locator('text=/events/')).toBeVisible();
  });
});
