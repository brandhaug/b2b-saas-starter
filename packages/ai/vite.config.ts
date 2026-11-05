import { defineConfig } from 'vite-plus'

export default defineConfig({
  test: {
    setupFiles: ['./test/network-setup.ts'],
    sequence: { concurrent: false }
  }
})
