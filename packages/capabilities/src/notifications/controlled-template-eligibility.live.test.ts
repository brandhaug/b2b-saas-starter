import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { layerFromD1 } from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { LiveControlledTemplateEligibilityEngine } from './adapters.ts'
import {
  ControlledTemplateEligibilityEngine,
  OperationalMessageIneligible
} from './controlled-template-eligibility.ts'

const destinationFingerprint =
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const input = {
  shopId: 'shp_live_eligibility',
  purpose: 'appointment_confirmation',
  locale: 'ro',
  channel: 'whatsapp',
  provider: 'meta',
  templateVersion: 1,
  destinationFingerprint,
  permission: { granted: true, destinationFingerprint },
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
  facts: {
    merchantLabel: 'Frizeria Ștefan',
    merchantSmsLabel: 'Frizeria Stefan',
    localizedDate: '30 octombrie 2026',
    smsDate: '30.10.2026',
    time: '09:30',
    locationLabel: 'București',
    locationSmsLabel: 'Bucuresti',
    reference: 'BZ-1234',
    confirmationUrl: 'https://bsolo.ro/c/Ab3'
  }
} as const

let test: TestD1

beforeAll(async () => {
  test = await provisionTestD1()
}, 60_000)

afterAll(async () => test.dispose())

const evaluateEffect = () =>
  Effect.flatMap(ControlledTemplateEligibilityEngine, (engine) =>
    engine.evaluate(input)
  ).pipe(
    Effect.provide(
      LiveControlledTemplateEligibilityEngine.pipe(Layer.provide(layerFromD1(test.d1)))
    )
  )

const evaluate = () => Effect.runPromise(evaluateEffect())

describe('Live controlled template eligibility', () => {
  it('uses exact persisted approval and disablement metadata', async () => {
    const pending = await Effect.runPromise(Effect.flip(evaluateEffect()))
    expect(pending).toBeInstanceOf(OperationalMessageIneligible)
    expect(pending.reason).toBe('template_disabled')

    await test.d1
      .prepare(
        `UPDATE messaging_template_versions
         SET enabled = 1, provider_approval_status = 'approved',
             provider_observed_category = 'utility',
             provider_approved_at = '2026-07-29T13:10:00.000Z',
             provider_approval_evidence_reference = 'qualification:meta:ro:confirmation:v1'
         WHERE id = 'mtv_ro_appointment_confirmation_whatsapp_v1'`
      )
      .run()
    await expect(evaluate()).resolves.toMatchObject({
      template: {
        id: 'mtv_ro_appointment_confirmation_whatsapp_v1',
        enabled: true,
        providerApproval: {
          status: 'approved',
          observedCategory: 'utility',
          evidenceReference: 'qualification:meta:ro:confirmation:v1'
        }
      }
    })

    await test.d1
      .prepare(
        `UPDATE messaging_template_versions
         SET enabled = 0, provider_approval_status = 'disabled'
         WHERE id = 'mtv_ro_appointment_confirmation_whatsapp_v1'`
      )
      .run()
    const disabled = await Effect.runPromise(Effect.flip(evaluateEffect()))
    expect(disabled).toMatchObject({
      _tag: 'OperationalMessageIneligible',
      reason: 'template_disabled'
    })
  })
})
