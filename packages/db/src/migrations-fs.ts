// Filesystem enumeration of drizzle-kit's folder-style migrations
// (migrations/<name>/migration.sql), shared by scripts/migrate.ts and the
// test-only ./testing subpath so both apply the same set in the same order.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = join(import.meta.dirname, '..', 'migrations')

/** Reads every committed migration, sorted by folder name (timestamp order). */
export const listMigrations = (): Array<{ name: string; sql: string }> =>
  readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf8')
    }))
