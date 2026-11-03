import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'pi',
    // the token and the channels of the tests, never the user's
    setupFiles: ['../bridge/tests/setup.ts'],
  },
})
