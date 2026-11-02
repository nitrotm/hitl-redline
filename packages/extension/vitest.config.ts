import { defineProject } from 'vitest/config'

// the extension's pure modules; the end-to-end tests (tests/e2e) have their own runners
export default defineProject({
  test: {
    name: 'extension',
    include: ['tests/unit/**/*.test.ts'],
    environment: 'happy-dom',
  },
})
