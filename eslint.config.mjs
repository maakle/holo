import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';
import local from './eslint-plugin-local/index.js';

export default tseslint.config(
  // Ignored paths
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/migrations/**',
      'eslint-plugin-local/**',
      'docs/**',
      '**/migrations/**',
      // Plan/spec markdown files contain Memex/holo references that aren't code
    ],
  },

  // Base TS recommended
  ...tseslint.configs.recommended,

  // Global rules
  {
    plugins: {
      'import-x': importX,
      local,
    },
    languageOptions: {
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'local/no-bare-throw-error': 'error',
    },
  },

  // packages/errors itself defines the error infrastructure; bare throws allowed there
  {
    files: ['packages/errors/**/*.ts'],
    rules: { 'local/no-bare-throw-error': 'off' },
  },

  // Boundary: apps/api and apps/mcp must access @holo/db only via @holo/retrieval-core.
  // EXCEPT for auth-related modules that legitimately need the DB in v0.0
  // (they'll route through retrieval-core in spec #2).
  {
    files: ['apps/api/src/**/*.ts', 'apps/mcp/src/**/*.ts'],
    rules: {
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: ['apps/api/src/**', 'apps/mcp/src/**'],
              from: ['packages/db/src/**'],
              except: ['apps/api/src/auth/**', 'apps/mcp/src/middleware/**'],
              message:
                'apps/api and apps/mcp must access the DB via @holo/retrieval-core, not @holo/db. (See ROADMAP.) Auth modules are temporarily excepted; spec #2 absorbs them through retrieval-core.',
            },
          ],
        },
      ],
    },
  },
);
