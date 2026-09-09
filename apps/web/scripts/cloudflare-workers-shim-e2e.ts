/* oxlint-disable effect/noNodeBuiltinImport -- this startup-only test harness
 * runs before the application Effect runtime. */
// Node preview variant of the `cloudflare:workers` shim. Unlike the Vite dev
// variant, this file is bundled into the built server, so it must resolve the
// workspace paths from the process working directory rather than
// `import.meta.dirname` (which points into dist/server after bundling).
import { type D1Database } from '@cloudflare/workers-types'
import { getPlatformProxy } from 'wrangler'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { env as baseEnv } from '../src/lib/cloudflare-workers-shim.ts'

const dbPackageDir = join(process.cwd(), '../../packages/db')
const localD1PersistPath = join(dbPackageDir, '.wrangler/state/v3')

async function provisionLocalD1(): Promise<D1Database> {
  if (!existsSync(join(localD1PersistPath, 'd1'))) {
    // oxlint-disable-next-line effect/noThrowStatement, effect/noNewError -- fail fast before the app runtime when test state is missing
    throw new Error(
      `Built E2E preview requires migrated local D1 at ${localD1PersistPath}. Run pnpm run db:migrate:local first.`
    )
  }
  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath: join(dbPackageDir, 'wrangler.jsonc'),
    persist: { path: localD1PersistPath }
  })
  // oxlint-disable-next-line no-console -- one-time preview startup notice
  console.log('[preview] local D1 attached from packages/db/.wrangler (seeded state)')
  return proxy.env.DB
}

const db = await provisionLocalD1()

export const env = { ...baseEnv, DB: db }
