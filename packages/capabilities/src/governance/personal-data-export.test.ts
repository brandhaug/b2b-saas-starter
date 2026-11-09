import { describe, expect, it } from 'vite-plus/test'

import {
  isExpiredPersonalDataExport,
  personalDataExportExpiresAt,
  PERSONAL_DATA_EXPORT_TTL_MS
} from './personal-data-export.ts'

describe('personal data export lifecycle', () => {
  it('births every archive with the same TTL horizon', () => {
    const now = 1_800_000_000_000
    expect(personalDataExportExpiresAt(now)).toBe(now + PERSONAL_DATA_EXPORT_TTL_MS)
    expect(PERSONAL_DATA_EXPORT_TTL_MS).toBe(24 * 60 * 60 * 1000)
  })

  it('expires exactly at the horizon and never before it', () => {
    const expiresAt = personalDataExportExpiresAt(0)
    expect(isExpiredPersonalDataExport(expiresAt, expiresAt - 1)).toBe(false)
    // The horizon itself is gone: an expiry instant is not served.
    expect(isExpiredPersonalDataExport(expiresAt, expiresAt)).toBe(true)
    expect(isExpiredPersonalDataExport(expiresAt, expiresAt + 1)).toBe(true)
  })
})
