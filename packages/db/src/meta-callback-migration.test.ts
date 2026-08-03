import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { provisionTestD1, type TestD1 } from './testing.ts'

describe('provider callback receipt migration', () => {
  let test: TestD1

  beforeAll(async () => {
    test = await provisionTestD1()
  })

  afterAll(async () => {
    await test.dispose()
  })

  it('durably deduplicates signed raw-body receipts and keeps them append-only', async () => {
    const insert = (id: string) =>
      test.d1
        .prepare(
          `INSERT OR IGNORE INTO provider_callback_receipts
           (id, environment, provider, provider_account_key, raw_body_digest,
            byte_length, event_count, received_at, created_at)
           VALUES (?, 'test', 'meta', 'platform-meta', ?, 512, 1, ?, ?)`
        )
        .bind(
          id,
          `sha256:${'a'.repeat(64)}`,
          '2026-07-29T09:00:00.000Z',
          '2026-07-29T09:00:00.000Z'
        )
        .run()

    await insert('pcr_meta_first')
    await insert('pcr_meta_duplicate')
    const row = await test.d1
      .prepare(
        `SELECT COUNT(*) AS count, MIN(id) AS id
         FROM provider_callback_receipts WHERE provider = 'meta'`
      )
      .first<{ count: number; id: string }>()
    expect(row).toEqual({ count: 1, id: 'pcr_meta_first' })
    await expect(
      test.d1
        .prepare(
          `UPDATE provider_callback_receipts SET event_count = 2
           WHERE id = 'pcr_meta_first'`
        )
        .run()
    ).rejects.toThrow(/append-only/)
    const obsoleteIndex = await test.d1
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'index' AND name = 'provider_evidence_message_status_unique'`
      )
      .first<{ name: string }>()
    expect(obsoleteIndex).toBeNull()
  })
})
