import assert from 'node:assert/strict'
import { readD1Migrations } from '@cloudflare/vitest-plugin'
import { listMigrations, migrationsDir } from '../../packages/db/src/migrations-fs.ts'

/** Native SQL parsing, with the same folder identities/order as deploy tooling. */
export function readPoolMigrations() {
  const committed = listMigrations()
  return readD1Migrations({
    projectPath: migrationsDir,
    migrationsDir: '.',
    migrationsPattern: '*/migration.sql'
  }).then((native) => {
    const byPath = new Map(native.map((migration) => [migration.name, migration]))
    assert.equal(native.length, committed.length, 'Native D1 discovery count differs')
    assert.equal(byPath.size, committed.length, 'Native D1 migration paths repeat')
    return committed.map(({ name }) => {
      const migration = byPath.get(`${name}/migration.sql`)
      assert(migration, `Native D1 reader did not discover ${name}/migration.sql`)
      return { name, queries: migration.queries }
    })
  })
}
