import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'release/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        console: 'readonly', process: 'readonly', window: 'readonly', document: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', URL: 'readonly', Buffer: 'readonly',
      },
    },
    rules: {
      // Сайтам и своим страницам — никакого eval и строкового кода.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
