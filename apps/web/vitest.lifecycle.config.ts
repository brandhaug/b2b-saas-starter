import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vite-plus'
import { workerCompatibility } from '../../infra/bindings'
import { listMigrations } from '../../packages/db/src/migrations-fs'

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './test/assistant/lifecycle-worker.ts',
      miniflare: {
        compatibilityDate: workerCompatibility.date,
        compatibilityFlags: [...workerCompatibility.flags],
        durableObjects: {
          ASSISTANT_CONVERSATIONS: {
            className: 'WorkspaceAssistantConversation',
            useSQLite: true
          }
        },
        d1Databases: ['DB'],
        bindings: {
          TEST_MIGRATIONS: listMigrations().map(({ name, sql }) => ({
            name,
            queries: sql
              .split('--> statement-breakpoint')
              .map((part) => part.trim())
              .filter(Boolean)
          })),
          OPENAI_API_KEY: 'local-test-key',
          OPENAI_BASE_URL: 'https://model.fixture/v1',
          ASSISTANT_PROVIDER_CONTEXT_TOKENS: '128000',
          ASSISTANT_PROVIDER_OUTPUT_TOKENS: '16000',
          ASSISTANT_INPUT_TOKENS: '64000',
          ASSISTANT_OUTPUT_TOKENS: '16000',
          ASSISTANT_ACTIVE_LIMIT: '3',
          ASSISTANT_RATE_LIMIT: '20',
          // Completed inference still owns its AbortSignal.timeout timer. Let it
          // expire naturally before eviction, with production I/O protection on.
          ASSISTANT_DEADLINE_MS: '5000'
        }
      }
    })
  ],
  test: { include: ['test/assistant/*.pool.test.ts'], testTimeout: 30_000 }
})
