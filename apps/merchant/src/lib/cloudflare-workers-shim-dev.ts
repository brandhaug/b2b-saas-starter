import type { D1Database } from '@cloudflare/workers-types'
import { join } from 'node:path'
import { getPlatformProxy } from 'wrangler'
import { env as baseEnv } from './cloudflare-workers-shim.ts'

const databaseConfig = join(
  import.meta.dirname,
  '../../../../packages/db/wrangler.jsonc'
)

const localD1 = getPlatformProxy<{ DB: D1Database }>({
  configPath: databaseConfig,
  persist: { path: join(import.meta.dirname, '../../../../packages/db/.wrangler') }
}).then((proxy) => proxy.env.DB)

export const env = {
  ...baseEnv,
  // The module graph is also evaluated in the browser; only the server needs
  // the D1 binding and can await it safely before an auth request is handled.
  DB: import.meta.env.SSR ? await localD1 : undefined
}
