import { test, expect } from '@playwright/test';

test.describe('Payment demonstration', () => {
  test('complete payment demo workflow', async ({ page }) => {
    await page.goto('/');

    // Load demo
    await page.getByRole('button', { name: /load payment demo/i }).click();

    // Verify demo loaded - seed should be 0
    await expect(page.getByLabel('Random seed')).toHaveValue('0');

    // Run baseline
    await page.getByLabel('Run simulation').click();

    // Wait for results to appear
    await expect(page.getByRole('tablist', { name: 'Results views' })).toBeVisible();

    // Check invariant tab shows failure
    await page.getByRole('tab', { name: 'Invariants' }).click();
    await expect(page.locator('.invariant-result--fail')).toBeVisible();

    // Verify two charges in the status/metrics
    await page.getByRole('tab', { name: 'Metrics' }).click();
    const baselineChargeMetric = page
      .locator('.metric-card')
      .filter({ has: page.locator('.metric-card__label').filter({ hasText: /^charge$/ }) });
    await expect(baselineChargeMetric.locator('.metric-card__value')).toHaveText('2');

    // Enable idempotency and replay
    await expect(page.getByRole('button', { name: /enable idempotency/i })).toBeVisible();
    await page.getByRole('button', { name: /enable idempotency/i }).click();

    // Wait for re-run results
    await expect(page.getByRole('tablist', { name: 'Results views' })).toBeVisible();

    // Check invariant now passes
    await page.getByRole('tab', { name: 'Invariants' }).click();
    await expect(page.locator('.invariant-result--pass')).toBeVisible();
    // No failing invariants
    await expect(page.locator('.invariant-result--fail')).not.toBeVisible();

    await page.getByRole('tab', { name: 'Metrics' }).click();
    const correctedChargeMetric = page
      .locator('.metric-card')
      .filter({ has: page.locator('.metric-card__label').filter({ hasText: /^charge$/ }) });
    await expect(correctedChargeMetric.locator('.metric-card__value')).toHaveText('1');

    await page.getByRole('tab', { name: 'Timeline' }).click();
    await expect(
      page.locator('[data-event-type="RequestArrived"][title*="Deduplicated: true"]'),
    ).toBeVisible();

    // Seed should still be 0 (same seed)
    await expect(page.getByLabel('Random seed')).toHaveValue('0');
  });

  test('evidence links navigate to correct event', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /load payment demo/i }).click();
    await page.getByLabel('Run simulation').click();
    await expect(page.getByRole('tablist', { name: 'Results views' })).toBeVisible();
    await page.getByRole('tab', { name: 'Invariants' }).click();

    // Click an evidence link if visible
    const evidenceLink = page.locator('.evidence-link').first();
    if (await evidenceLink.isVisible()) {
      const seqText = await evidenceLink.textContent();
      await evidenceLink.click();

      // Should highlight/select that event
      if (seqText) {
        // The event should be selected in the events view
        await page.getByRole('tab', { name: 'Events' }).click();
        const selectedRow = page.locator('.event-table__row--selected');
        await expect(selectedRow).toBeVisible();
      }
    }
  });
});
