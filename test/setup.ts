// Polyfill ResizeObserver for React Flow in jsdom
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

// Polyfill DOMMatrixReadOnly for React Flow
if (typeof DOMMatrixReadOnly === 'undefined') {
  (global as unknown as Record<string, unknown>).DOMMatrixReadOnly = class DOMMatrixReadOnly {
    m22 = 1;
    constructor() {}
    inverse() {
      return this;
    }
  };
}
