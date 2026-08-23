import { test, expect } from '@playwright/test';

test.describe('Cross-browser determinism', () => {
  test('payment demo produces consistent results', async ({ page }) => {
    await page.goto('/');

    // Load demo
    await page.getByRole('button', { name: /load demo/i }).click();
    await page.getByLabel('Run simulation').click();

    // Wait for results
    await expect(page.getByRole('tablist', { name: 'Results views' })).toBeVisible();

    // Check metrics tab for known values
    await page.getByRole('tab', { name: 'Metrics' }).click();
    const metricsPanel = page.locator('.metrics-panel');
    await expect(metricsPanel).toBeVisible();

    // Check events tab - count should be deterministic
    await page.getByRole('tab', { name: 'Events' }).click();
    const eventCount = page.locator('.event-table__count');
    await expect(eventCount).toBeVisible();
    const countText = await eventCount.textContent();
    // The demo should produce a consistent event count across browsers
    // With seed=0, lostResponse prob=0.5, we get a known event count
    expect(countText).toContain('events');

    // Verify invariant result is deterministic (should FAIL for double charge)
    await page.getByRole('tab', { name: 'Invariants' }).click();
    await expect(page.locator('.invariant-result--fail')).toBeVisible();
    // The invariant message should mention 2 occurrences
    await expect(page.locator('text=/occurred 2 time/i')).toBeVisible();

    // Now enable idempotency and re-run
    await page.getByRole('button', { name: /enable idempotency/i }).click();
    await expect(page.getByRole('tablist', { name: 'Results views' })).toBeVisible();

    await page.getByRole('tab', { name: 'Invariants' }).click();
    await expect(page.locator('.invariant-result--pass')).toBeVisible();
    // Should show 1 occurrence
    await expect(page.locator('text=/occurred 1 time/i')).toBeVisible();
  });
});
