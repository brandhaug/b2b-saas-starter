import { Effect, Redacted } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  ControlledTemplateInvalid,
  controlledTemplateCatalog,
  evaluateOperationalMessageEligibility,
  OperationalMessageIneligible,
  protectRomanianDestination,
  renderControlledTemplate
} from './controlled-template-eligibility.ts'

const facts = {
  merchantLabel: 'Frizeria Ștefan',
  merchantSmsLabel: 'Frizeria Stefan',
  localizedDate: 'joi, 30 octombrie 2026',
  smsDate: '30.10.2026',
  time: '09:30',
  locationLabel: 'Strada Înfrățirii 10, București',
  locationSmsLabel: 'Strada Infratirii 10',
  reference: 'BZ-1234',
  confirmationUrl: 'https://bsolo.ro/c/Ab3'
} as const

const destinationFingerprint =
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

const approvedCatalog = controlledTemplateCatalog.map((template) =>
  template.channel === 'whatsapp'
    ? {
        ...template,
        enabled: true,
        providerApproval: {
          ...template.providerApproval!,
          observedCategory: 'utility' as const,
          status: 'approved' as const,
          approvedAt: '2026-07-29T00:00:00.000Z',
          evidenceReference: `qualification:${template.id}`
        }
      }
    : template
)

const eligibleInput = {
  purpose: 'appointment_confirmation',
  locale: 'ro',
  channel: 'whatsapp',
  provider: 'meta',
  templateVersion: 1,
  destinationFingerprint,
  permission: {
    granted: true,
    destinationFingerprint
  },
  suppressions: [],
  controls: {
    globalEnabled: true,
    merchantEnabled: true,
    merchantFrozen: false,
    purposeEnabled: true,
    channelEnabled: true,
    providerConfigured: true
  },
  now: '2026-10-30T07:00:00.000Z',
  appointmentStartsAt: '2026-10-30T08:30:00.000Z',
  shopTimeZone: 'Europe/Bucharest',
  facts
} as const

describe('controlled Operational Messaging templates', () => {
  it('renders every Romanian and English version deterministically by channel', async () => {
    expect(controlledTemplateCatalog).toHaveLength(16)

    const outputs = await Promise.all(
      controlledTemplateCatalog.map((template) =>
        Effect.runPromise(
          renderControlledTemplate({
            template,
            facts:
              template.purpose === 'appointment_confirmation'
                ? facts
                : { ...facts, confirmationUrl: '' }
          })
        ).then((output) => ({
          ...output,
          body: Redacted.value(output.body)
        }))
      )
    )

    expect(outputs).toEqual([
      {
        body: 'Programarea la Frizeria Ștefan este confirmată pentru joi, 30 octombrie 2026, 09:30, la Strada Înfrățirii 10, București. Referință: BZ-1234. Detalii: https://bsolo.ro/c/Ab3. Pentru ajutor, contactează comerciantul sau suportul beesolo.',
        gsm7Units: null
      },
      {
        body: 'Frizeria Stefan: Confirmat 30.10.2026 09:30, Strada Infratirii 10. Ref BZ-1234. https://bsolo.ro/c/Ab3',
        gsm7Units: 102
      },
      {
        body: 'Memento de la Frizeria Ștefan: programarea este joi, 30 octombrie 2026, 09:30, la Strada Înfrățirii 10, București. Referință: BZ-1234. Pentru ajutor, contactează comerciantul sau suportul beesolo.',
        gsm7Units: null
      },
      {
        body: 'Frizeria Stefan: Memento 30.10.2026 09:30, Strada Infratirii 10. Ref BZ-1234.',
        gsm7Units: 77
      },
      {
        body: 'Frizeria Ștefan a anulat programarea din joi, 30 octombrie 2026, 09:30. Referință: BZ-1234. Pentru ajutor, contactează comerciantul sau suportul beesolo.',
        gsm7Units: null
      },
      {
        body: 'Frizeria Stefan: Anulat 30.10.2026 09:30. Ref BZ-1234.',
        gsm7Units: 54
      },
      {
        body: 'Frizeria Ștefan a reprogramat programarea pentru joi, 30 octombrie 2026, 09:30, la Strada Înfrățirii 10, București. Referință: BZ-1234. Pentru ajutor, contactează comerciantul sau suportul beesolo.',
        gsm7Units: null
      },
      {
        body: 'Frizeria Stefan: Reprogramat 30.10.2026 09:30, Strada Infratirii 10. Ref BZ-1234.',
        gsm7Units: 81
      },
      {
        body: 'Your appointment with Frizeria Ștefan is confirmed for joi, 30 octombrie 2026 at 09:30, at Strada Înfrățirii 10, București. Reference: BZ-1234. Details: https://bsolo.ro/c/Ab3. For help, contact the merchant or beesolo support.',
        gsm7Units: null
      },
      {
        body: 'Frizeria Stefan: Confirmed 30.10.2026 09:30, Strada Infratirii 10. Ref BZ-1234. https://bsolo.ro/c/Ab3',
        gsm7Units: 102
      },
      {
        body: 'Reminder from Frizeria Ștefan: your appointment is joi, 30 octombrie 2026 at 09:30, at Strada Înfrățirii 10, București. Reference: BZ-1234. For help, contact the merchant or beesolo support.',
        gsm7Units: null
      },
      {
        body: 'Frizeria Stefan: Reminder 30.10.2026 09:30, Strada Infratirii 10. Ref BZ-1234.',
        gsm7Units: 78
      },
      {
        body: 'Frizeria Ștefan cancelled your appointment for joi, 30 octombrie 2026 at 09:30. Reference: BZ-1234. For help, contact the merchant or beesolo support.',
        gsm7Units: null
      },
      {
        body: 'Frizeria Stefan: Cancelled 30.10.2026 09:30. Ref BZ-1234.',
        gsm7Units: 57
      },
      {
        body: 'Frizeria Ștefan rescheduled your appointment to joi, 30 octombrie 2026 at 09:30, at Strada Înfrățirii 10, București. Reference: BZ-1234. For help, contact the merchant or beesolo support.',
        gsm7Units: null
      },
      {
        body: 'Frizeria Stefan: Rescheduled 30.10.2026 09:30, Strada Infratirii 10. Ref BZ-1234.',
        gsm7Units: 81
      }
    ])
  })

  it('accepts maximum controlled fields while keeping every route inside its envelope', async () => {
    const maximumFacts = {
      merchantLabel: 'M'.repeat(40),
      merchantSmsLabel: 'M'.repeat(24),
      localizedDate: 'D'.repeat(32),
      smsDate: '31.12.2026',
      time: '23:59',
      locationLabel: 'L'.repeat(64),
      locationSmsLabel: 'L'.repeat(28),
      reference: 'R'.repeat(12),
      confirmationUrl: 'https://bsolo.ro/c/123456789012'
    }

    const outputs = await Promise.all(
      controlledTemplateCatalog.map((template) =>
        Effect.runPromise(
          renderControlledTemplate({
            template,
            facts:
              template.purpose === 'appointment_confirmation'
                ? maximumFacts
                : { ...maximumFacts, confirmationUrl: '' }
          })
        )
      )
    )

    for (const [index, output] of outputs.entries()) {
      if (controlledTemplateCatalog[index]?.channel === 'whatsapp')
        expect(Redacted.value(output.body).length).toBeLessThanOrEqual(500)
      else {
        expect(output.gsm7Units).not.toBeNull()
        expect(output.gsm7Units).toBeLessThanOrEqual(160)
      }
    }
  })

  it.each([
    ['merchant_label_too_long', { merchantLabel: 'M'.repeat(41) }],
    ['merchant_sms_label_too_long', { merchantSmsLabel: 'M'.repeat(25) }],
    ['localized_date_too_long', { localizedDate: 'D'.repeat(33) }],
    ['sms_date_invalid', { smsDate: '2026-10-30' }],
    ['time_invalid', { time: '9:30' }],
    ['location_label_too_long', { locationLabel: 'L'.repeat(65) }],
    ['location_sms_label_too_long', { locationSmsLabel: 'L'.repeat(29) }],
    ['reference_too_long', { reference: 'R'.repeat(13) }],
    ['confirmation_url_invalid', { confirmationUrl: 'http://unsafe.test/x' }],
    ['url_not_allowed', { merchantLabel: 'https://unsafe.test' }],
    ['unknown_controlled_field', { customerName: 'Irina' }],
    ['sms_not_gsm7', { merchantSmsLabel: 'Salon 😊' }]
  ] as const)('rejects invalid controlled content with %s', async (reason, patch) => {
    const template =
      reason === 'sms_not_gsm7' || reason.includes('sms')
        ? controlledTemplateCatalog[1]!
        : controlledTemplateCatalog[0]!
    const error = await Effect.runPromise(
      Effect.flip(
        renderControlledTemplate({
          template,
          facts: { ...facts, ...patch }
        })
      )
    )

    expect(error).toBeInstanceOf(ControlledTemplateInvalid)
    expect(error.reason).toBe(reason)
  })

  it('rejects a Confirmation URL on every non-confirmation purpose', async () => {
    for (const template of controlledTemplateCatalog.filter(
      ({ purpose }) => purpose !== 'appointment_confirmation'
    )) {
      const error = await Effect.runPromise(
        Effect.flip(renderControlledTemplate({ template, facts }))
      )
      expect(error).toMatchObject({
        _tag: 'ControlledTemplateInvalid',
        reason: 'confirmation_url_not_allowed'
      })
    }
  })

  it('normalizes, masks, fingerprints, and encrypts a Romanian destination', async () => {
    const keys = {
      encryptionKey: Redacted.make(new Uint8Array(32).fill(17)),
      fingerprintKey: Redacted.make(new Uint8Array(32).fill(29)),
      keyVersion: 3
    }
    const first = await Effect.runPromise(
      protectRomanianDestination({
        rawDestination: Redacted.make('0722 123 456'),
        countryCode: 'RO',
        ...keys
      })
    )
    const second = await Effect.runPromise(
      protectRomanianDestination({
        rawDestination: Redacted.make('+40 722 123 456'),
        countryCode: 'RO',
        ...keys
      })
    )

    expect(first).toMatchObject({
      countryCode: 'RO',
      maskedValue: '+40•••••••456',
      keyVersion: 3
    })
    expect(first.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(first.fingerprint).toBe(second.fingerprint)
    expect(Redacted.value(first.ciphertext)).not.toBe(Redacted.value(second.ciphertext))
    expect(JSON.stringify(first)).not.toContain('+40722123456')
    expect(JSON.stringify(first)).not.toContain(Redacted.value(first.ciphertext))
  })

  it.each([
    ['RO', 'not-a-number', 'invalid_destination'],
    ['RO', '+442079460018', 'unsupported_country'],
    ['US', '0722123456', 'unsupported_country']
  ] as const)(
    'fails destination protection closed for %s / %s',
    async (countryCode, rawDestination, reason) => {
      const error = await Effect.runPromise(
        Effect.flip(
          protectRomanianDestination({
            rawDestination: Redacted.make(rawDestination),
            countryCode,
            encryptionKey: Redacted.make(new Uint8Array(32).fill(17)),
            fingerprintKey: Redacted.make(new Uint8Array(32).fill(29)),
            keyVersion: 3
          })
        )
      )

      expect(error).toMatchObject({
        _tag: 'ProtectedDestinationFailure',
        reason
      })
    }
  )

  it('selects only the exact approved and enabled template version', async () => {
    const result = await Effect.runPromise(
      evaluateOperationalMessageEligibility(eligibleInput, {
        catalog: approvedCatalog
      })
    )

    expect(result).toMatchObject({
      availableAt: eligibleInput.now,
      template: {
        id: 'mtv_ro_appointment_confirmation_whatsapp_v1',
        version: 1,
        enabled: true,
        providerApproval: {
          provider: 'meta',
          requestedCategory: 'utility',
          observedCategory: 'utility',
          status: 'approved'
        }
      },
      rendered: {
        gsm7Units: null
      }
    })
  })

  it.each([
    [
      '2026-03-28T19:30:00.000Z',
      '2026-03-29T09:00:00.000Z',
      '2026-03-29T05:00:00.000Z'
    ],
    [
      '2026-10-24T18:30:00.000Z',
      '2026-10-25T10:00:00.000Z',
      '2026-10-25T06:00:00.000Z'
    ],
    ['2026-10-25T06:00:00.000Z', '2026-10-25T10:00:00.000Z', '2026-10-25T06:00:00.000Z']
  ])(
    'schedules a useful reminder inside 08:00–20:00 across DST (%s)',
    async (now, appointmentStartsAt, availableAt) => {
      const result = await Effect.runPromise(
        evaluateOperationalMessageEligibility(
          {
            ...eligibleInput,
            purpose: 'appointment_reminder',
            facts: { ...facts, confirmationUrl: '' },
            now,
            appointmentStartsAt
          },
          {
            catalog: approvedCatalog
          }
        )
      )

      expect(result.availableAt).toBe(availableAt)
    }
  )

  it('keeps confirmation, cancellation, and reschedule immediate outside reminder hours', async () => {
    for (const purpose of [
      'appointment_confirmation',
      'appointment_cancellation',
      'appointment_reschedule'
    ] as const) {
      const result = await Effect.runPromise(
        evaluateOperationalMessageEligibility(
          {
            ...eligibleInput,
            purpose,
            now: '2026-10-30T21:30:00.000Z',
            appointmentStartsAt: '2026-10-30T08:30:00.000Z',
            facts:
              purpose === 'appointment_confirmation'
                ? facts
                : { ...facts, confirmationUrl: '' }
          },
          { catalog: approvedCatalog }
        )
      )

      expect(result.availableAt).toBe('2026-10-30T21:30:00.000Z')
    }
  })

  it('ignores future, expired, revoked, other-destination, and other-channel suppressions', async () => {
    const result = await Effect.runPromise(
      evaluateOperationalMessageEligibility(
        {
          ...eligibleInput,
          suppressions: [
            {
              destinationFingerprint,
              scope: 'all_operational',
              effectiveAt: '2026-11-01T00:00:00.000Z'
            },
            {
              destinationFingerprint,
              scope: 'all_operational',
              effectiveAt: '2026-10-01T00:00:00.000Z',
              expiresAt: '2026-10-29T00:00:00.000Z'
            },
            {
              destinationFingerprint,
              scope: 'all_operational',
              effectiveAt: '2026-10-01T00:00:00.000Z',
              revokedAt: '2026-10-29T00:00:00.000Z'
            },
            {
              destinationFingerprint:
                'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
              scope: 'all_operational',
              effectiveAt: '2026-10-01T00:00:00.000Z'
            },
            {
              destinationFingerprint,
              scope: 'sms',
              effectiveAt: '2026-10-01T00:00:00.000Z'
            }
          ]
        },
        { catalog: approvedCatalog }
      )
    )

    expect(result.template.channel).toBe('whatsapp')
  })

  it.each([
    [
      'operational_permission_missing',
      {
        permission: {
          granted: false,
          destinationFingerprint
        }
      },
      undefined
    ],
    [
      'operational_permission_destination_mismatch',
      {
        permission: {
          granted: true,
          destinationFingerprint:
            'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
        }
      },
      undefined
    ],
    [
      'destination_suppressed',
      {
        suppressions: [
          {
            destinationFingerprint,
            scope: 'all_operational',
            effectiveAt: '2026-10-01T00:00:00.000Z'
          }
        ]
      },
      undefined
    ],
    [
      'channel_suppressed',
      {
        suppressions: [
          {
            destinationFingerprint,
            scope: 'whatsapp',
            effectiveAt: '2026-10-01T00:00:00.000Z'
          }
        ]
      },
      undefined
    ],
    [
      'global_kill_switch',
      { controls: { ...eligibleInput.controls, globalEnabled: false } },
      undefined
    ],
    [
      'merchant_messaging_disabled',
      { controls: { ...eligibleInput.controls, merchantEnabled: false } },
      undefined
    ],
    [
      'merchant_frozen',
      { controls: { ...eligibleInput.controls, merchantFrozen: true } },
      undefined
    ],
    [
      'notification_purpose_disabled',
      { controls: { ...eligibleInput.controls, purposeEnabled: false } },
      undefined
    ],
    [
      'channel_kill_switch',
      { controls: { ...eligibleInput.controls, channelEnabled: false } },
      undefined
    ],
    [
      'provider_needs_configuration',
      { controls: { ...eligibleInput.controls, providerConfigured: false } },
      undefined
    ],
    ['route_not_supported', { provider: 'smso' }, undefined],
    ['template_version_not_found', { templateVersion: 2 }, undefined],
    [
      'template_disabled',
      {},
      approvedCatalog.map((template) =>
        template.id === 'mtv_ro_appointment_confirmation_whatsapp_v1'
          ? { ...template, enabled: false }
          : template
      )
    ],
    [
      'template_not_approved',
      {},
      approvedCatalog.map((template) =>
        template.id === 'mtv_ro_appointment_confirmation_whatsapp_v1'
          ? {
              ...template,
              providerApproval: {
                ...template.providerApproval!,
                status: 'rejected' as const
              }
            }
          : template
      )
    ],
    [
      'template_category_mismatch',
      {},
      approvedCatalog.map((template) =>
        template.id === 'mtv_ro_appointment_confirmation_whatsapp_v1'
          ? {
              ...template,
              providerApproval: {
                ...template.providerApproval!,
                observedCategory: 'marketing' as const
              }
            }
          : template
      )
    ],
    [
      'invalid_controlled_content',
      { facts: { ...facts, merchantLabel: 'M'.repeat(41) } },
      undefined
    ],
    ['invalid_shop_timezone', { shopTimeZone: 'Mars/Olympus' }, undefined],
    [
      'reminder_no_longer_useful',
      {
        purpose: 'appointment_reminder',
        facts: { ...facts, confirmationUrl: '' },
        now: '2026-10-30T19:30:00.000Z',
        appointmentStartsAt: '2026-10-31T05:00:00.000Z'
      },
      undefined
    ]
  ] as const)(
    'returns the exhaustive safe ineligibility reason %s',
    async (reason, patch, catalog) => {
      const error = await Effect.runPromise(
        Effect.flip(
          evaluateOperationalMessageEligibility(
            { ...eligibleInput, ...patch } as typeof eligibleInput,
            { catalog: catalog ?? approvedCatalog }
          )
        )
      )

      expect(error).toBeInstanceOf(OperationalMessageIneligible)
      expect(error.reason).toBe(reason)
    }
  )
})
