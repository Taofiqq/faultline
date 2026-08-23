import { test, expect } from '@playwright/test';
import { join } from 'path';
import { writeFileSync, mkdirSync } from 'fs';

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

    // Create a temp file with invalid JSON
    const tmpDir = join(__dirname, '..', '..', 'tmp-test');
    mkdirSync(tmpDir, { recursive: true });
    const badFile = join(tmpDir, 'bad.json');
    writeFileSync(badFile, '{not valid json!!!}');

    // Upload the file
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(badFile);

    // Should show import errors
    await expect(page.locator('[role="alert"]')).toBeVisible();
  });

  test('import semantically invalid file shows errors', async ({ page }) => {
    await page.goto('/');

    const tmpDir = join(__dirname, '..', '..', 'tmp-test');
    mkdirSync(tmpDir, { recursive: true });
    const badFile = join(tmpDir, 'invalid-schema.json');
    writeFileSync(
      badFile,
      JSON.stringify({
        schemaVersion: 1,
        seed: -1, // invalid negative seed
        services: [],
        paths: [],
        invariants: [],
      }),
    );

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(badFile);

    // Should show validation errors
    await expect(page.locator('[role="alert"]')).toBeVisible();
  });
});
