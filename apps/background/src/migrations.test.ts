// Node-only verification of the config-time reader against deploy tooling.
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vite-plus/test'
import { listMigrations } from '../../../packages/db/src/migrations-fs.ts'
import { readPoolMigrations } from '../migrations.config.ts'

function snapshot(db: DatabaseSync) {
  return db
    .prepare(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"
    )
    .all()
}

// The native parser retains the leading breakpoint comment and may remove the
// final delimiter. Keep all other SQL bytes, including literals and trigger bodies.
function executableSql(sql: string) {
  return sql
    .replace(/^--> statement-breakpoint\s*/, '')
    .trim()
    .replace(/;$/, '')
}

// Failure cases: missing nested files, relative-path bookkeeping names, changed
// order, and SQL comments/literals/trigger bodies split into different statements.
function verifyMigrations(native: Awaited<ReturnType<typeof readPoolMigrations>>) {
  const current = listMigrations()
  expect(current.length).toBeGreaterThan(0)
  expect(native.map(({ name }) => name)).toEqual(current.map(({ name }) => name))
  const legacyDb = new DatabaseSync(':memory:')
  const nativeDb = new DatabaseSync(':memory:')
  try {
    for (const [index, migration] of current.entries()) {
      const statements = migration.sql
        .split('--> statement-breakpoint')
        .map((sql) => sql.trim())
        .filter(Boolean)
      const loaded = native[index]
      expect(loaded).toBeDefined()
      if (!loaded) {
        return
      }
      expect(loaded.queries).toHaveLength(statements.length)
      expect(loaded.queries.map(executableSql)).toEqual(statements.map(executableSql))
      for (const sql of statements) {
        legacyDb.exec(sql)
      }
      for (const sql of loaded.queries) {
        nativeDb.exec(sql)
      }
      expect(snapshot(nativeDb)).toEqual(snapshot(legacyDb))
    }
  } finally {
    legacyDb.close()
    nativeDb.close()
  }
}

it('preserves committed migration names, order and schema after every migration', () =>
  readPoolMigrations().then(verifyMigrations))
