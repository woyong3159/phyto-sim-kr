import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
  define: {
    __APP_VERSION__: JSON.stringify('test'),
    __SINGLE_FILE__: 'false',
  },
});
