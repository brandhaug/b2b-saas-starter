import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig(({ command, mode }) => ({
  server: { host: true, port: 3072 },
  preview: { host: true, port: 3072 },
  resolve: {
    tsconfigPaths: true,
    // Development and tests run through the local D1 shim; the deployed
    // Worker keeps this virtual module external for Cloudflare to provide.
    alias:
      command === 'serve' || mode === 'test'
        ? {
            'cloudflare:workers': resolve(
              import.meta.dirname,
              command === 'serve'
                ? './src/lib/cloudflare-workers-shim-dev.ts'
                : './src/lib/cloudflare-workers-shim.ts'
            )
          }
        : {}
  },
  build: { rolldownOptions: { external: ['cloudflare:workers'] } },
  ssr: { external: ['cloudflare:workers'] },
  plugins: [tailwindcss(), tanstackStart(), viteReact()]
}))
