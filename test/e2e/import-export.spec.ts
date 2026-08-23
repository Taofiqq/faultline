import { test, expect } from '@playwright/test';

test.describe('Import/Export', () => {
  test('export scenario produces a downloadable file', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /load payment demo/i }).click();

    // Start waiting for download before clicking
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /export/i }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toContain('.json');
  });

  test('import malformed JSON shows error', async ({ page }) => {
    await page.goto('/');

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{not valid json!!!}'),
    });

    // Should show import errors
    await expect(page.locator('[role="alert"]')).toBeVisible();
  });

  test('import semantically invalid file shows errors', async ({ page }) => {
    await page.goto('/');

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'invalid-schema.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          seed: -1, // invalid negative seed
          services: [],
          paths: [],
          invariants: [],
        }),
      ),
    });

    // Should show validation errors
    await expect(page.locator('[role="alert"]')).toBeVisible();
  });
});
