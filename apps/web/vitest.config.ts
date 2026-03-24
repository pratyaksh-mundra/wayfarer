import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
  resolve: {
    alias: {
      '@wayfarer/core': path.resolve(__dirname, '../../packages/core'),
    },
  },
})
