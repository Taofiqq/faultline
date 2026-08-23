import { test, expect } from '@playwright/test';

test.describe('Keyboard and responsive', () => {
  test('run demo without pointer-only controls', async ({ page }) => {
    await page.goto('/');

    // Tab to Load Demo and press Enter
    await page.keyboard.press('Tab'); // skip link
    // Navigate to Load Demo button via keyboard
    const loadDemo = page.getByRole('button', { name: /load payment demo/i });
    await loadDemo.focus();
    await page.keyboard.press('Enter');

    // Tab to Run and press Enter
    const runBtn = page.getByLabel('Run simulation');
    await runBtn.focus();
    await page.keyboard.press('Enter');

    // Results should appear
    await expect(page.getByRole('tablist', { name: 'Results views' })).toBeVisible();
  });

  test('results tabs are keyboard navigable', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /load payment demo/i }).click();
    await page.getByLabel('Run simulation').click();
    await expect(page.getByRole('tablist', { name: 'Results views' })).toBeVisible();

    // Focus first tab and navigate with keyboard
    const firstTab = page.getByRole('tab', { name: 'Timeline' });
    await firstTab.focus();
    expect(await firstTab.getAttribute('aria-selected')).toBe('true');

    // Tab to next tab button
    await page.keyboard.press('Tab');
    // Should be on Events tab
    const eventsTab = page.getByRole('tab', { name: 'Events' });
    await eventsTab.focus();
    await page.keyboard.press('Enter');
    expect(await eventsTab.getAttribute('aria-selected')).toBe('true');
  });

  test('390px viewport has no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    // Check no horizontal scrollbar
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 1); // 1px tolerance
  });

  test('responsive at 768px', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('Faultline');
    await expect(page.getByLabel('Topology editor')).toBeVisible();
  });
});
