import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'bridge',
    setupFiles: ['tests/setup.ts'],
  },
})
