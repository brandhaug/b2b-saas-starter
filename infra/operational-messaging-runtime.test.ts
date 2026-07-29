import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  messagingSecretBindings,
  operationalMessagingRuntime,
  validateMessagingBindingAuthority,
  validateQualificationConfiguration
} from './operational-messaging-runtime.ts'

describe('Operational Messaging production runtime contract', () => {
  it('keeps qualification isolated from customer traffic and owns recovery schedules', () => {
    expect(operationalMessagingRuntime.qualification.customerTrafficEnabled).toBe(false)
    expect(operationalMessagingRuntime.queue.recoveryCron).toBe('*/5 * * * *')
    expect(operationalMessagingRuntime.jobs).toEqual({
      ambiguityAlertAfterHours: 24,
      ambiguityCloseAfterDays: 7,
      reconciliationCron: '*/5 * * * *',
      retentionCron: '*/5 * * * *'
    })
  })

  it('enforces least-authority provider and destination bindings', () => {
    expect(
      validateMessagingBindingAuthority({
        api: [
          'DB',
          'BOOKING_EVENTS_QUEUE',
          'META_WHATSAPP_APP_SECRET',
          'META_WHATSAPP_WEBHOOK_VERIFY_TOKEN',
          'META_WHATSAPP_REFERENCE_FINGERPRINT_KEY',
          'SMSO_CALLBACK_PATH_SECRET',
          'SMSO_PROVIDER_REFERENCE_FINGERPRINT_KEY'
        ],
        background: [
          'DB',
          'BOOKING_EVENTS_QUEUE',
          'EMAIL',
          'META_WHATSAPP_ACCESS_TOKEN',
          'META_WHATSAPP_REFERENCE_ENCRYPTION_KEY',
          'META_WHATSAPP_REFERENCE_FINGERPRINT_KEY',
          'SMSO_API_KEY',
          'SMSO_CALLBACK_URL',
          'SMSO_PROVIDER_REFERENCE_ENCRYPTION_KEY',
          'SMSO_PROVIDER_REFERENCE_FINGERPRINT_KEY',
          'OPERATIONAL_MESSAGING_DESTINATION_ENCRYPTION_KEY',
          'OPERATIONAL_MESSAGING_DESTINATION_FINGERPRINT_KEY'
        ],
        booking: [
          'DB',
          'BOOKING_EVENTS_QUEUE',
          'OPERATIONAL_MESSAGING_DESTINATION_ENCRYPTION_KEY',
          'OPERATIONAL_MESSAGING_DESTINATION_FINGERPRINT_KEY'
        ],
        merchant: ['DB', 'EMAIL'],
        operations: ['DB', 'EMAIL'],
        web: ['DB', 'EMAIL', 'BOOKING']
      })
    ).toEqual([])

    expect(
      validateMessagingBindingAuthority({
        api: ['META_WHATSAPP_ACCESS_TOKEN'],
        background: [],
        booking: [],
        merchant: ['SMSO_API_KEY'],
        operations: [],
        web: []
      })
    ).toEqual([
      'api must not receive META_WHATSAPP_ACCESS_TOKEN',
      'merchant must not receive SMSO_API_KEY'
    ])
  })

  it('checks the messaging secrets present in both actual Alchemy topologies', () => {
    const secretsIn = (source: string, start: string, end: string) => {
      const block = source.slice(source.indexOf(start), source.indexOf(end))
      return messagingSecretBindings.filter((secret) => block.includes(secret))
    }
    const production = readFileSync(
      new URL('../alchemy.run.ts', import.meta.url),
      'utf8'
    )
    expect(
      validateMessagingBindingAuthority({
        api: secretsIn(production, 'const api =', 'const merchant ='),
        background: secretsIn(production, 'const background =', 'const web ='),
        booking: secretsIn(production, 'const booking =', 'const background ='),
        merchant: secretsIn(production, 'const merchant =', 'const operations ='),
        operations: secretsIn(production, 'const operations =', 'const booking ='),
        web: secretsIn(production, 'const web =', 'return {')
      })
    ).toEqual([])
    const qualification = readFileSync(
      new URL('../alchemy.messaging-qualification.ts', import.meta.url),
      'utf8'
    )
    expect(
      validateMessagingBindingAuthority({
        api: secretsIn(qualification, 'const api =', 'const background ='),
        background: secretsIn(qualification, 'const background =', 'QueueConsumer'),
        booking: [],
        merchant: [],
        operations: [],
        web: []
      })
    ).toEqual([])
  })

  it('fails qualification closed on partial key pairs or enabled customer traffic', () => {
    expect(
      validateQualificationConfiguration({
        deployment: 'qualification',
        customerTrafficEnabled: false,
        configured: operationalMessagingRuntime.qualification.requiredConfiguration
      })
    ).toEqual({ state: 'ready', missing: [], violations: [] })

    expect(
      validateQualificationConfiguration({
        deployment: 'qualification',
        customerTrafficEnabled: true,
        configured: ['META_WHATSAPP_ACCESS_TOKEN']
      })
    ).toEqual({
      state: 'blocked',
      missing: expect.arrayContaining(['SMSO_API_KEY']),
      violations: expect.arrayContaining([
        'qualification_customer_traffic_must_be_disabled',
        'meta_submission_configuration_must_be_complete'
      ])
    })
  })
})
