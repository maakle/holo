import '../../tools/test-env';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30000,
    // DB-backed tests share a single org/user fixture; disable cross-file
    // parallelism so they don't trample each other's user_subjects_cache rows.
    fileParallelism: false,
  },
});
