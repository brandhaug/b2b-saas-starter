/* oxlint-disable effect/noNodeBuiltinImport -- Playwright owns disposable credentials in the local test database. */
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { localD1PersistPath } from '../src/lib/local-d1-state'

export function removeBrowserTestPasskeys(): void {
  const directory = join(localD1PersistPath, 'd1/miniflare-D1DatabaseObject')
  const filename = readdirSync(directory).find(
    (name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite'
  )
  assert(filename, 'Local D1 database was not found')
  const db = new DatabaseSync(join(directory, filename))
  // These names belong to the browser fixture and lifecycle test. Human
  // enrollments and every other user's credentials remain untouched.
  db.prepare(
    "DELETE FROM passkey WHERE userId = 'usr_demo' AND (name LIKE 'E2E shared authentication%' OR name IN ('E2E key', 'Renamed key'))"
  ).run()
  db.close()
}
