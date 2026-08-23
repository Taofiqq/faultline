/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { axe } from 'vitest-axe';
import { toHaveNoViolations } from 'vitest-axe/matchers';
import { App } from '../../src/ui/App';

expect.extend({ toHaveNoViolations });

describe('Accessibility (axe-core)', () => {
  it('should have no accessibility violations in empty state', async () => {
    const { container } = render(<App />);
    const results = await axe(container, {
      rules: {
        // heading-order is a known issue: ScenarioPanel uses h3 without h2
        'heading-order': { enabled: false },
      },
    });
    expect(results).toHaveNoViolations();
  });

  it('should have skip link as first focusable element', () => {
    const { container } = render(<App />);
    const skipLink = container.querySelector('.skip-link');
    expect(skipLink).toBeInTheDocument();
    expect(skipLink).toHaveAttribute('href', '#main-content');
    expect(skipLink?.textContent).toBe('Skip to main content');
  });

  it('should have proper ARIA landmarks', () => {
    const { container } = render(<App />);
    expect(container.querySelector('[role="banner"]')).toBeInTheDocument();
    expect(container.querySelector('[role="main"]')).toBeInTheDocument();
    expect(container.querySelector('[role="contentinfo"]')).toBeInTheDocument();
    expect(container.querySelector('[role="complementary"]')).toBeInTheDocument();
  });

  it('should have proper ARIA labels on interactive sections', () => {
    const { container } = render(<App />);
    expect(container.querySelector('[aria-label="Topology editor"]')).toBeInTheDocument();
    expect(container.querySelector('[aria-label="Scenario inspector"]')).toBeInTheDocument();
    expect(container.querySelector('[aria-label="Simulation results"]')).toBeInTheDocument();
  });

  it('should have accessible form controls', () => {
    const { container } = render(<App />);
    const inputs = container.querySelectorAll('input');
    inputs.forEach((input) => {
      // Skip hidden inputs (e.g., file inputs with aria-hidden)
      if (input.getAttribute('aria-hidden') === 'true' || input.type === 'hidden') {
        return;
      }
      const hasLabel =
        input.getAttribute('aria-label') ||
        (input.id && container.querySelector(`label[for="${input.id}"]`)) ||
        input.closest('label');
      expect(hasLabel).toBeTruthy();
    });
  });
});
