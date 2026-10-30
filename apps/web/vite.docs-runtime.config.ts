import { resolve } from 'node:path'
import { defineConfig, mergeConfig, type Plugin } from 'vite-plus'
import baseConfig from './vite.config'

// Native SSR, with a test-only gate around request-owned document rendering.
export default defineConfig((environment) =>
  mergeConfig(baseConfig({ ...environment, mode: 'docs-runtime' }), {
    ssr: { noExternal: true, target: 'webworker' },
    plugins: [
      {
        name: 'docs-runtime-render-gate',
        enforce: 'pre',
        configEnvironment(name: string) {
          if (name !== 'ssr') {
            return
          }
          return {
            resolve: { conditions: ['workerd', 'worker', 'browser'] },
            build: {
              rolldownOptions: {
                output: {
                  banner:
                    "import { createRequire } from 'node:module'; const require = createRequire('/worker.js');"
                }
              }
            }
          }
        },
        resolveId(source: string, importer: string | undefined) {
          if (source.startsWith('@tanstack/')) {
            return this.error(
              `Legacy runtime dependency ${source} imported by ${importer}`
            )
          }
          if (
            source.endsWith('/src/entry.server.ts') &&
            !importer?.endsWith('/test/docs/render-gate.ts')
          ) {
            return resolve(import.meta.dirname, 'test/docs/render-gate.ts')
          }
          return null
        }
      } satisfies Plugin
    ]
  })
)
