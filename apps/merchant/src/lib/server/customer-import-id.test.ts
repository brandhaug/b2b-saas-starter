import { describe, expect, it } from 'vitest'
import { customerImportFileId } from './customer-import-id.ts'

describe('Customer import file identity', () => {
  it('is stable, payload-bound, and does not expose imported PII', async () => {
    const rows = [{ name: 'Ana Popescu', email: 'ana@example.com', phone: null }]
    const first = await customerImportFileId(rows, 'merchant-secret')
    const replay = await customerImportFileId(rows, 'merchant-secret')
    const changed = await customerImportFileId(
      [{ ...rows[0], email: 'different@example.com' }],
      'merchant-secret'
    )

    expect(replay).toBe(first)
    expect(changed).not.toBe(first)
    expect(first).not.toContain('Ana Popescu')
    expect(first).not.toContain('ana@example.com')
  })
})
