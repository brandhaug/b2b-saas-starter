import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig(({ command, mode }) => ({
  server: {
    host: true,
    port: 3076,
    allowedHosts: ['hassans-macbook-pro.tail8c0b7c.ts.net']
  },
  preview: { host: true, port: 3076 },
  test: { fileParallelism: false },
  resolve: {
    tsconfigPaths: true,
    alias:
      command === 'serve' || mode === 'test'
        ? {
            'cloudflare:workers': resolve(
              import.meta.dirname,
              command === 'serve'
                ? mode === 'operations-browser-test'
                  ? './src/lib/cloudflare-workers-shim-browser-test.ts'
                  : './src/lib/cloudflare-workers-shim-dev.ts'
                : './src/lib/cloudflare-workers-shim.ts'
            )
          }
        : {}
  },
  build: { rolldownOptions: { external: ['cloudflare:workers'] } },
  ssr: { external: ['cloudflare:workers'] },
  plugins: [tailwindcss(), tanstackStart(), viteReact()]
}))
