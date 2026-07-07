import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.d.ts', 'web/public/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // server + shared run on Node. `scripts/**/*.ts` (Phase 9 seed/reset,
  // run via `tsx`) also runs on Node, reaching into `server/src` directly.
  {
    files: ['server/**/*.ts', 'shared/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
  // web runs in the browser (Telegram WebView) and uses React.
  {
    files: ['web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  // Root-level config/tooling files (this file, vite/vitest configs, scripts).
  {
    files: ['*.config.{js,ts,cjs,mjs}', 'scripts/**/*.{js,cjs,mjs}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  prettierConfig,
);
