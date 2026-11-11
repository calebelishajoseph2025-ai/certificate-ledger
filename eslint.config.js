import jsxA11y from 'eslint-plugin-jsx-a11y';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'backend/**',
      'api/**',
      'coverage/**',
      'e2e/test-results/**',
      'e2e/playwright-report/**',
      'scripts/.protected-baseline.json',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}', 'e2e/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: {jsx: true},
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...jsxA11y.configs.recommended.rules,
      'jsx-a11y/control-has-associated-label': 'off',
      'no-eval': 'error',
      'no-implied-eval': 'error',
    },
  },
);
