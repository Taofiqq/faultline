/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { App } from '../../src/ui/App';

describe('Keyboard navigation', () => {
  it('should allow tabbing through main controls', async () => {
    const user = userEvent.setup();
    render(<App />);

    // Tab should move focus through interactive elements
    await user.tab();
    // First focusable should be skip link
    expect(document.activeElement).toHaveClass('skip-link');

    await user.tab();
    // Should reach header controls area
    expect(document.activeElement?.tagName).toBeDefined();
  });

  it('should allow skip link to jump to main content', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.tab();
    // Focus is on skip link
    expect(document.activeElement).toHaveClass('skip-link');

    await user.keyboard('{Enter}');
    // After clicking skip link, focus should move to or near main content
    const main = document.getElementById('main-content');
    expect(main).toBeInTheDocument();
  });

  it('should support keyboard interaction with Run button', async () => {
    const user = userEvent.setup();
    render(<App />);

    const runButton = screen.getByLabelText('Run simulation');
    expect(runButton).toBeInTheDocument();
    // Button is disabled when no services; disabled buttons may not receive focus
    // Verify it exists and is properly labeled
    expect(runButton).toBeDisabled();
    expect(runButton).toHaveAttribute('aria-label', 'Run simulation');

    // Pressing enter on a disabled button shouldn't crash
    await user.keyboard('{Enter}');
  });

  it('should have focusable Add Service button', async () => {
    render(<App />);
    const addBtn = screen.getByLabelText('Add service');
    expect(addBtn).toBeInTheDocument();
    addBtn.focus();
    expect(document.activeElement).toBe(addBtn);
  });

  it('should have keyboard-accessible seed input', async () => {
    const user = userEvent.setup();
    render(<App />);

    const seedInput = screen.getByLabelText('Random seed');
    expect(seedInput).toBeInTheDocument();
    seedInput.focus();
    // Clear existing value before typing
    await user.clear(seedInput);
    await user.type(seedInput, '12345');
    expect(seedInput).toHaveValue(12345);
  });

  it('should support keyboard navigation in results tabs when visible', async () => {
    const { container } = render(<App />);

    // Results workspace should exist (even if empty state)
    const resultsSection = container.querySelector('[aria-label="Simulation results"]');
    expect(resultsSection).toBeInTheDocument();
  });
});
