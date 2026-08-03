import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyMigrations, provisionUnmigratedTestD1, type TestD1 } from './testing.ts'

const operationalMessagingMigration = '20260729120000_operational_messaging'
const templateApprovalInvariantMigration =
  '20260729131000_messaging_template_approval_invariants'
let test: TestD1

beforeAll(async () => {
  test = await provisionUnmigratedTestD1()
  await applyMigrations(test.d1, { through: operationalMessagingMigration })
  await test.d1
    .prepare(
      `INSERT INTO messaging_template_versions
       (id, purpose, locale, channel, version, body_fingerprint,
        provider_template_key, effective_at, created_at)
       VALUES ('mtv_upgrade', 'appointment_confirmation', 'ro', 'whatsapp', 1,
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'beesolo_confirmation_ro_v1', '2026-07-29T00:00:00.000Z',
        '2026-07-29T00:00:00.000Z')`
    )
    .run()
  await applyMigrations(test.d1, {
    after: operationalMessagingMigration,
    through: templateApprovalInvariantMigration
  })
}, 60_000)

afterAll(async () => test.dispose())

describe('messaging template approval metadata migration', () => {
  it('preserves existing versions as pending and disabled until exact approval', async () => {
    const row = await test.d1
      .prepare(
        `SELECT enabled, provider_requested_category, provider_observed_category,
                provider_approval_status, provider_approved_at,
                provider_approval_evidence_reference
         FROM messaging_template_versions WHERE id = 'mtv_upgrade'`
      )
      .first()

    expect(row).toEqual({
      enabled: 0,
      provider_requested_category: 'utility',
      provider_observed_category: null,
      provider_approval_status: 'pending',
      provider_approved_at: null,
      provider_approval_evidence_reference: null
    })
  })

  it('constrains approval status and provider category metadata', async () => {
    await expect(
      test.d1
        .prepare(
          `INSERT INTO messaging_template_versions
           (id, purpose, locale, channel, version, body_fingerprint,
            effective_at, enabled, provider_requested_category,
            provider_approval_status, created_at)
           VALUES ('mtv_invalid_status', 'appointment_confirmation', 'ro', 'whatsapp', 2,
            'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            '2026-07-29T00:00:00.000Z', 1, 'utility', 'invented',
            '2026-07-29T00:00:00.000Z')`
        )
        .run()
    ).rejects.toThrow()

    await expect(
      test.d1
        .prepare(
          `INSERT INTO messaging_template_versions
           (id, purpose, locale, channel, version, body_fingerprint,
            effective_at, enabled, provider_requested_category,
            provider_observed_category, provider_approval_status, created_at)
           VALUES ('mtv_invalid_category', 'appointment_confirmation', 'ro', 'whatsapp', 3,
            'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
            '2026-07-29T00:00:00.000Z', 1, 'utility', 'social', 'approved',
            '2026-07-29T00:00:00.000Z')`
        )
        .run()
    ).rejects.toThrow()
  })

  it('preserves SMS v1 and activates the immutable help/STOP v2 versions', async () => {
    const rows = await test.d1
      .prepare(
        `SELECT channel, enabled, provider_approval_status, COUNT(*) AS total
         FROM messaging_template_versions
         GROUP BY channel, enabled, provider_approval_status
         ORDER BY channel, enabled`
      )
      .all()

    expect(rows.results).toEqual([
      {
        channel: 'sms',
        enabled: 0,
        provider_approval_status: 'pending',
        total: 8
      },
      {
        channel: 'sms',
        enabled: 1,
        provider_approval_status: 'pending',
        total: 8
      },
      {
        channel: 'whatsapp',
        enabled: 0,
        provider_approval_status: 'pending',
        total: 8
      }
    ])

    const smsVersions = await test.d1
      .prepare(
        `SELECT version, enabled, body_fingerprint
         FROM messaging_template_versions
         WHERE purpose = 'appointment_confirmation' AND locale = 'ro' AND channel = 'sms'
         ORDER BY version`
      )
      .all()
    expect(smsVersions.results).toEqual([
      {
        version: 1,
        enabled: 0,
        body_fingerprint:
          'sha256:998a641d32a9d74e4b30775ca9090c951705ec7a90b65e78bc97d5360631e3fa'
      },
      {
        version: 2,
        enabled: 1,
        body_fingerprint:
          'sha256:8ac171f906f52b00208f763498085d1f8286954bd2dd097dc81a23c790fdb904'
      }
    ])
  })

  it('requires complete durable evidence before a WhatsApp version becomes approved', async () => {
    await expect(
      test.d1
        .prepare(
          `UPDATE messaging_template_versions
           SET enabled = 1, provider_approval_status = 'approved',
               provider_observed_category = 'utility'
           WHERE id = 'mtv_en_appointment_confirmation_whatsapp_v1'`
        )
        .run()
    ).rejects.toThrow()

    await test.d1
      .prepare(
        `UPDATE messaging_template_versions
         SET enabled = 1, provider_approval_status = 'approved',
             provider_observed_category = 'utility',
             provider_approved_at = '2026-07-29T13:10:00.000Z',
             provider_approval_evidence_reference = 'qualification:meta:en:confirmation:v1'
         WHERE id = 'mtv_en_appointment_confirmation_whatsapp_v1'`
      )
      .run()

    const approved = await test.d1
      .prepare(
        `SELECT enabled, provider_approval_status, provider_observed_category,
                provider_approved_at, provider_approval_evidence_reference
         FROM messaging_template_versions
         WHERE id = 'mtv_en_appointment_confirmation_whatsapp_v1'`
      )
      .first()
    expect(approved).toEqual({
      enabled: 1,
      provider_approval_status: 'approved',
      provider_observed_category: 'utility',
      provider_approved_at: '2026-07-29T13:10:00.000Z',
      provider_approval_evidence_reference: 'qualification:meta:en:confirmation:v1'
    })
  })
})
