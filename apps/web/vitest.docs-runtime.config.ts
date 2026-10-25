import { defineConfig } from 'vite-plus'

export default defineConfig({
  test: { include: ['test/docs/cold-runtime.test.ts'], testTimeout: 30_000 }
})
