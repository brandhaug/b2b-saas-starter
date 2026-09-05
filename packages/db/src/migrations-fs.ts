// Filesystem enumeration of drizzle-kit's folder-style migrations
// (migrations/<name>/migration.sql), shared by scripts/migrate.ts and the
// test-only ./testing subpath so both apply the same set in the same order.
//
// A build- and test-time filesystem adapter: `scripts/migrate.ts` (a Node CLI) and
// the `./testing` subpath both call it synchronously, outside any Effect runtime,
// so there is no FileSystem/Path service to read the migrations through.
// oxlint-disable effect/noNodeBuiltinImport -- no Effect runtime at either call site
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = join(import.meta.dirname, '..', 'migrations')

/** Reads every committed migration, sorted by folder name (timestamp order). */
export function listMigrations(): Array<{ name: string; sql: string }> {
  const names = readdirSync(migrationsDir, { withFileTypes: true }).reduce<
    Array<string>
  >((folders, entry) => {
    if (entry.isDirectory()) {
      folders.push(entry.name)
    }
    return folders
  }, [])
  return names.toSorted().map((name) => ({
    name,
    sql: readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf8')
  }))
}
