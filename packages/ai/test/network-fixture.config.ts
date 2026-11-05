import { defineConfig } from 'vite-plus'

export default defineConfig({
  test: {
    include: ['test/network.case.ts'],
    setupFiles: ['./test/network-setup.ts'],
    sequence: { concurrent: false }
  }
})
