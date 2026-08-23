import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage', 'playwright-report', 'test-results'] },

  // Base config for all files
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // Engine-specific: forbidden non-deterministic APIs
  {
    files: ['src/engine/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'Date',
          message: 'Date is non-deterministic. Use logical clock in engine.',
        },
        {
          name: 'performance',
          message: 'performance.now() is non-deterministic. Use logical clock.',
        },
        {
          name: 'setTimeout',
          message: 'Async scheduling forbidden in deterministic engine.',
        },
        {
          name: 'setInterval',
          message: 'Async scheduling forbidden in deterministic engine.',
        },
        {
          name: 'queueMicrotask',
          message: 'Async scheduling forbidden in deterministic engine.',
        },
        {
          name: 'crypto',
          message: 'crypto.getRandomValues is non-deterministic. Use seeded PRNG.',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Math.random() is non-deterministic. Use seeded PRNG.',
        },
        {
          object: 'globalThis',
          property: 'crypto',
          message: 'crypto is non-deterministic. Use seeded PRNG.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'NewExpression[callee.name="Date"]',
          message: 'new Date() is non-deterministic. Use logical clock.',
        },
        {
          selector: 'CallExpression[callee.object.name="Date"][callee.property.name="now"]',
          message: 'Date.now() is non-deterministic. Use logical clock.',
        },
        {
          selector: 'AwaitExpression',
          message: 'Async/await forbidden in deterministic engine.',
        },
        {
          selector: 'NewExpression[callee.name="Promise"]',
          message: 'Promises forbidden in deterministic engine.',
        },
      ],
    },
  },
);
