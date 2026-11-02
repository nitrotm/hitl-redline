import { defineConfig } from '@playwright/test'

// The end-to-end tests: the built extension (yarn build) in a real browser, against a real
// `redline wait`. One at a time: the bridge's port is the extension's.
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '*.spec.ts',
  workers: 1,
  timeout: 60_000,
  reporter: 'list',
})
