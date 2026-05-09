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
      '.claude/**',
      // Plan/spec markdown files contain Memex/holo references that aren't code.
      // .claude/ holds local agent state (worktrees, hooks, scheduled-tasks lock)
      // that may include checked-out source from sibling branches; never lint it.
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
      // Promoted from warn to error: the codebase already disables on each
      // explicit `any` (Hono <any,any,any>, tree-sitter dynamic loaders,
      // generic registry maps), so error-level only blocks NEW unguarded
      // anys. Add an `// eslint-disable-next-line @typescript-eslint/no-explicit-any`
      // with a one-line comment explaining the escape hatch when truly needed.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'local/no-bare-throw-error': 'error',
    },
  },

  // packages/errors itself defines the error infrastructure; bare throws allowed there.
  // Test files (root tests/**, per-package and per-app test dirs, plus colocated
  // *.test.ts inside src/) use bare throws for fixture guards ("seed missing —
  // bail loudly") and to simulate handler failures; the rule's intent is to
  // catch production throws, not test-internal sentinels.
  {
    files: [
      'packages/errors/**/*.ts',
      'tests/**/*.ts',
      'packages/*/test/**/*.ts',
      'apps/*/test/**/*.ts',
      '**/*.test.ts',
      '**/*.test.tsx',
    ],
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
