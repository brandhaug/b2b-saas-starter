import { describe, expect, it } from 'vitest'
import type { SharedCommandInput } from '../foundation/index.ts'
import { classifyAppointmentRestrictedMutation } from './restricted-access-policy.ts'

const command = {
  authority: { kind: 'owner-session', sessionId: 'ses_owner' },
  merchantId: 'mer_one',
  operation: 'mutation',
  capability: 'appointment',
  aggregateId: 'apt_one',
  idempotencyKey: 'command',
  payloadFingerprint: 'sha256:command',
  expectedRevision: 1,
  resultJson: '{}',
  historyKind: 'appointment.changed',
  now: '2026-08-03T00:00:00.000Z'
} as const satisfies SharedCommandInput

const classified = (action: string, target = 'apt_one') =>
  classifyAppointmentRestrictedMutation(
    command,
    {
      kind: 'appointment-existing-commitment',
      payloadJson: JSON.stringify({ appointmentId: target, action })
    },
    { resourceExists: true }
  )

describe('appointment shared Restricted Access boundary', () => {
  it('denies command attempts that create new demand', () => {
    expect(classified('merchant-create')).toBe(false)
    expect(classified('record-completed')).toBe(false)
  })

  it('admits the complete existing-commitment command matrix', () => {
    for (const action of [
      'edit',
      'reschedule',
      'cancel',
      'complete',
      'no-show',
      'outcome-correction',
      'external-collection',
      'whole-party-cancel'
    ])
      expect(classified(action)).toBe(true)
  })

  it('denies exceptions for missing or cross-merchant resources', () => {
    expect(classified('edit', 'apt_other')).toBe(false)
    expect(
      classifyAppointmentRestrictedMutation(
        command,
        {
          kind: 'appointment-existing-commitment',
          payloadJson: JSON.stringify({ appointmentId: 'apt_one', action: 'edit' })
        },
        { resourceExists: false }
      )
    ).toBe(false)
  })
})
