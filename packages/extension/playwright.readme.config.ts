import { defineConfig } from '@playwright/test'

// The README's pictures (`yarn shots`): the built extension (yarn build) in the dev shell's
// Chromium, as the end-to-end tests run it, but out of `yarn test:e2e`.
export default defineConfig({
  testDir: 'tests/readme',
  testMatch: '*.spec.ts',
  workers: 1,
  reporter: 'list',
})
