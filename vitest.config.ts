import { defineConfig } from 'vitest/config'

// the unit and bridge tests of every workspace; the end-to-end tests have their own runners
export default defineConfig({
  test: {
    projects: ['packages/*'],
  },
})
