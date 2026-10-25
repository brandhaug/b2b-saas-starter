import { resolve } from 'node:path'
import { defineConfig, mergeConfig } from 'vite-plus'
import baseConfig from './vite.config'

// Native SSR, with a test-only gate around the real metadata enumeration.
export default defineConfig((environment) =>
  mergeConfig(baseConfig(environment), {
    build: { outDir: 'dist-docs-runtime' },
    ssr: { noExternal: true, target: 'webworker' },
    plugins: [
      {
        name: 'docs-runtime-metadata-gate',
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
          if (
            /(?:^|\/)docs\.effects(?:\.ts)?$/.test(source) &&
            importer?.includes('/src/lib/docs.ts')
          ) {
            return resolve(import.meta.dirname, 'test/docs/metadata-gate.effects.ts')
          }
          return null
        }
      }
    ]
  })
)
