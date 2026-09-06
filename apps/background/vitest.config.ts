import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { configDefaults, defineConfig } from 'vite-plus'

import { listMigrations } from '../../packages/db/src/migrations-fs.ts'

// Two projects, one file set each: the existing `*.test.ts` suites keep the
// plain Node runner they run under today, and only the `*.pool.test.ts`
// suites move into the workers pool (`@cloudflare/vitest-pool-workers`), so
// the pool's workerd startup cost never touches the rest of the suite.
//
// D1 state inside the pool comes from the real migrations: the pool cannot
// read them itself (`readD1Migrations` understands wrangler's flat
// `<n>_*.sql` layout, drizzle-kit writes `<timestamp>_<name>/migration.sql`),
// so the folder walk is the db package's own single source (`listMigrations`,
// shared with `scripts/migrate.ts` and `packages/db/src/testing.ts`) and only
// the statement split is repeated here — the same `--> statement-breakpoint`
// split those two apply. The migrations are read here at config time (Node)
// and handed to the pool as a plain-data binding; the test files apply them
// with `applyD1Migrations` inside workerd.
const migrations = listMigrations().map(({ name, sql }) => ({
  name,
  queries: sql
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
}))

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'background',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.pool.test.ts', ...configDefaults.exclude]
        }
      },
      {
        plugins: [
          cloudflareTest({
            // The generated wrangler config is the bindings source: the same
            // D1 database, queue producers, and compatibility flags the
            // worker deploys with, simulated by miniflare.
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: {
              bindings: { TEST_MIGRATIONS: migrations }
            }
          })
        ],
        test: {
          name: 'background-pool',
          include: ['src/**/*.pool.test.ts']
        }
      }
    ]
  }
})
