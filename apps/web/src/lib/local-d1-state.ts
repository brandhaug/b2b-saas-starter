// Node-only browser-test storage discovery. Alchemy dev and the compiled
// Miniflare preview deliberately use separate disposable databases.
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '../../../..')
export const localD1Directory =
  process.env.E2E_SERVER === 'dev'
    ? join(root, '.alchemy/local/d1/cloudflare-runtime-D1DatabaseObject')
    : join(root, 'packages/db/.wrangler/state/v3/d1/miniflare-D1DatabaseObject')

/** Whether a migrated local D1 exists under the persist root. */
export function hasLocalD1State(): boolean {
  return existsSync(localD1Directory)
}
