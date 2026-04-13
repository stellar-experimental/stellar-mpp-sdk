import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['sdk/src/**/*.test.ts', 'examples/**/*.test.ts'],
  },
})
