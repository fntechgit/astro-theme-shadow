import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/*.test.ts'],
    env: { ASTRO_TELEMETRY_DISABLED: '1' },
    // The Astro tests each run a real build or dev server.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
