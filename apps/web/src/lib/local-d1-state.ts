// Single source of truth for the persisted local D1 location in packages/db
// (created by `bun run db:migrate:local`). Node-only: the e2e smoke spec
// imports it directly (Playwright runs in Node), and the dev shim imports it
// dynamically behind its `import.meta.env.SSR` guard so the browser never
// evaluates the node:* imports.
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Absolute path to packages/db, resolved from this module's location. */
export const dbPackageDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/db'
)

/** Wrangler persist root passed to getPlatformProxy. */
export const localD1PersistPath = join(dbPackageDir, '.wrangler/state/v3')

/** Whether a migrated local D1 exists under the persist root. */
export const hasLocalD1State = (): boolean => existsSync(join(localD1PersistPath, 'd1'))
