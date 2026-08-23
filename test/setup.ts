// Polyfill ResizeObserver for React Flow in jsdom
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

// jsdom logs a noisy "not implemented" warning when axe probes canvas support.
// The application does not use canvas, so a null context is the accurate test fallback.
if (typeof HTMLCanvasElement !== 'undefined') {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => null,
  });
}

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
