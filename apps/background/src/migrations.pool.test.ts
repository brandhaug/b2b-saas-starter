import { env } from 'cloudflare:workers'
import { expect, it } from 'vite-plus/test'
import { applyPoolMigrations, db } from './test-pool.ts'

// Failure case: a native relative-path name changes d1_migrations identity and
// makes already-applied schema run twice. Exercise actual workerd bookkeeping.
it('records folder names in order and skips a second migration application', () => {
  function recorded() {
    return db()
      .prepare('SELECT * FROM d1_migrations ORDER BY id')
      .all<{ name: string }>()
  }
  function assertRecorded(result: { results: Array<{ name: string }> }) {
    for (const { name } of result.results) {
      expect(name).toMatch(/^\d{14}_[^/]+$/)
    }
    expect(result.results.map(({ name }) => name)).toEqual(
      env.TEST_MIGRATIONS.map(({ name }) => name)
    )
  }
  return applyPoolMigrations()
    .then(recorded)
    .then(assertRecorded)
    .then(applyPoolMigrations)
    .then(recorded)
    .then(assertRecorded)
})
