import react from '@astrojs/react'
import { defineConfig } from 'astro/config'
import { themeShadow } from '../../../src/index.ts'

export default defineConfig({
  devToolbar: { enabled: false },
  integrations: [react(), themeShadow({ themes: [{ name: '@fixture/theme', dir: '../theme' }] })],
})
