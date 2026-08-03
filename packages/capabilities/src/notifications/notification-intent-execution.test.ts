import { Effect, Layer, Redacted } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import {
  controlledTemplateCatalog,
  evaluateOperationalMessageEligibility,
  OperationalMessageIneligible,
  protectRomanianDestination,
  SeedControlledTemplateEligibilityEngine
} from './controlled-template-eligibility.ts'
import { deriveNotificationDestinationProtection } from './booking-intent-producer.ts'
import {
  NotificationIntentLifecycle,
  SeedNotificationIntentLifecycle,
  type NotificationIntentLifecycleShape,
  type PrepareNotificationIntentInput
} from './notification-intent-lifecycle.ts'
import { ProviderSubmission } from './provider-contracts.ts'
import {
  makeNotificationIntentExecutionLayer,
  NotificationIntentExecution,
  NotificationIntentExecutionStore,
  type NotificationIntentExecutionContext
} from './notification-intent-execution.ts'
import { makeProtectedDestinationReveal } from './notification-intent-execution.live.ts'

const now = '2026-07-29T12:00:00.000Z'

const prepared = (
  purpose: PrepareNotificationIntentInput['purpose'] = 'appointment_confirmation'
): PrepareNotificationIntentInput => ({
  id: `nti_execute_${purpose}`,
  shopId: 'shp_execute',
  topic: purpose.replace('_', '.'),
  sourceType: 'appointment',
  sourceId: 'apt_execute',
  sourceVersion: 1,
  recipientRole: 'customer',
  recipientSnapshot: {
    ciphertext: 'ciphertext:customer',
    fingerprint: `sha256:${'1'.repeat(64)}`,
    maskedValue: '+40•••••••456',
    countryCode: 'RO',
    keyVersion: 1
  },
  deduplicationKey: `execute:${purpose}:1`,
  purpose,
  locale: 'ro',
  availableAt: now,
  createdAt: now
})

const context = (intentId: string): NotificationIntentExecutionContext => ({
  intentId,
  appointmentStartsAt: '2026-07-30T12:00:00.000Z',
  shopTimeZone: 'Europe/Bucharest',
  permission: {
    granted: true,
    destinationFingerprint: `sha256:${'1'.repeat(64)}`
  },
  facts: {
    merchantLabel: 'BeeSolo Studio',
    merchantSmsLabel: 'BeeSolo',
    localizedDate: '30 iulie 2026',
    smsDate: '30.07.2026',
    time: '15:00',
    locationLabel: 'Strada Florilor 10, București',
    locationSmsLabel: 'Str Florilor 10',
    reference: 'APT-123',
    confirmationUrl: 'https://bsolo.ro/c/APT123'
  }
})

const approvedTemplates = controlledTemplateCatalog.map((template) =>
  template.channel === 'whatsapp'
    ? {
        ...template,
        enabled: true,
        providerApproval: {
          ...template.providerApproval!,
          observedCategory: 'utility' as const,
          status: 'approved' as const,
          approvedAt: now,
          evidenceReference: `test:${template.id}`
        }
      }
    : template
)

const scenario = async (options: {
  readonly intent?: PrepareNotificationIntentInput
  readonly executionContext?: NotificationIntentExecutionContext
  readonly availableMilliEuro?: number
  readonly evaluator?: typeof evaluateOperationalMessageEligibility
  readonly outcomes: readonly Record<string, unknown>[]
  readonly beforeExecute?: (
    lifecycle: NotificationIntentLifecycleShape,
    intent: PrepareNotificationIntentInput
  ) => Effect.Effect<unknown, unknown, never>
  readonly executeAt?: string | readonly string[]
}) => {
  const intent = options.intent ?? prepared()
  const outcomes = [...options.outcomes]
  const submit = vi.fn(() => Effect.succeed(outcomes.shift()! as never))
  const evaluator =
    options.evaluator ??
    ((input: unknown) =>
      evaluateOperationalMessageEligibility(input, {
        catalog: approvedTemplates
      }))
  const lifecycle = SeedNotificationIntentLifecycle({
    availableMilliEuroByShop: new Map([
      [intent.shopId, options.availableMilliEuro ?? 1_000]
    ]),
    eligibilityEvaluator: evaluator
  })
  const layer = makeNotificationIntentExecutionLayer({
    environment: 'test',
    providerAccountKeys: { meta: 'meta_test', smso: 'smso_test' },
    revealDestination: () => Effect.succeed(Redacted.make('+40722123456'))
  }).pipe(
    Layer.provide(lifecycle),
    Layer.provide(SeedControlledTemplateEligibilityEngine(approvedTemplates)),
    Layer.provide(Layer.succeed(ProviderSubmission)({ submit })),
    Layer.provide(
      Layer.succeed(NotificationIntentExecutionStore)({
        load: () => Effect.succeed(options.executionContext ?? context(intent.id)),
        discoverDue: () => Effect.succeed([intent.id])
      })
    )
  )
  const aggregate = await Effect.runPromise(
    Effect.gen(function* () {
      const lifecycleService = yield* NotificationIntentLifecycle
      yield* lifecycleService.prepare(intent)
      if (options.beforeExecute) yield* options.beforeExecute(lifecycleService, intent)
      const execution = yield* NotificationIntentExecution
      const executionTimes = Array.isArray(options.executeAt)
        ? options.executeAt
        : [options.executeAt ?? now]
      for (const executionTime of executionTimes)
        yield* execution.execute({ intentId: intent.id, now: executionTime })
      return yield* lifecycleService.findById(intent.id)
    }).pipe(Effect.provide(Layer.merge(layer, lifecycle)))
  )
  return { aggregate, submit }
}

describe('Notification Intent execution', () => {
  it('reveals only the matching protected-destination key version at provider time', async () => {
    const protection = await Effect.runPromise(
      deriveNotificationDestinationProtection({
        encryption: 'execution-encryption-secret',
        fingerprint: 'execution-fingerprint-secret',
        keyVersion: 3
      })
    )
    const protectedDestination = await Effect.runPromise(
      protectRomanianDestination({
        rawDestination: Redacted.make('+40722123456'),
        countryCode: 'RO',
        ...protection
      })
    )
    const reveal = makeProtectedDestinationReveal({
      encryptionSecret: 'execution-encryption-secret',
      keyVersion: 3
    })
    const destination = await Effect.runPromise(
      reveal(Redacted.value(protectedDestination.ciphertext), 3)
    )
    expect(Redacted.value(destination)).toBe('+40722123456')
    await expect(
      Effect.runPromise(reveal(Redacted.value(protectedDestination.ciphertext), 2))
    ).rejects.toMatchObject({
      capability: 'notification-intent-execution'
    })
  })

  it('writes attempts before provider calls and falls back only after terminal WhatsApp rejection', async () => {
    const intent = prepared()
    const events: string[] = []
    const submit = vi
      .fn()
      .mockImplementationOnce((request) => {
        events.push(`provider:${request.channel}`)
        return Effect.succeed({
          _tag: 'rejected' as const,
          classification: 'terminal' as const,
          code: 'provider_rejected' as const
        })
      })
      .mockImplementationOnce((request) => {
        events.push(`provider:${request.channel}`)
        return Effect.succeed({
          _tag: 'accepted' as const,
          providerReferenceFingerprint: `sha256:${'2'.repeat(64)}`,
          acceptedAt: now
        })
      })
    const lifecycle = SeedNotificationIntentLifecycle({
      eligibilityEvaluator: (input) =>
        evaluateOperationalMessageEligibility(input, {
          catalog: approvedTemplates
        })
    })
    const layer = makeNotificationIntentExecutionLayer({
      environment: 'test',
      providerAccountKeys: { meta: 'meta_test', smso: 'smso_test' },
      revealDestination: () => Effect.succeed(Redacted.make('+40722123456'))
    }).pipe(
      Layer.provide(lifecycle),
      Layer.provide(SeedControlledTemplateEligibilityEngine(approvedTemplates)),
      Layer.provide(Layer.succeed(ProviderSubmission)({ submit })),
      Layer.provide(
        Layer.succeed(NotificationIntentExecutionStore)({
          load: () => Effect.succeed(context(intent.id)),
          discoverDue: () => Effect.succeed([intent.id])
        })
      )
    )

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const lifecycleService = yield* NotificationIntentLifecycle
        yield* lifecycleService.prepare(intent)
        const execution = yield* NotificationIntentExecution
        yield* execution.execute({ intentId: intent.id, now })
        const awaiting = yield* lifecycleService.findById(intent.id)
        const smsAttempt = awaiting.routes[1]!.attempts[0]!
        return yield* lifecycleService.ingestEvidence({
          id: 'pevd_execute_sms_delivery',
          intentId: intent.id,
          attemptId: smsAttempt.id,
          environment: 'test',
          providerAccountKey: 'smso_test',
          source: 'query',
          sourceEventKey: 'smso:execute:delivered',
          providerReferenceFingerprint: `sha256:${'2'.repeat(64)}`,
          status: 'delivered',
          trusted: true,
          observedAt: '2026-07-29T12:01:00.000Z'
        })
      }).pipe(Effect.provide(Layer.merge(layer, lifecycle)))
    )

    expect(
      result.routes.map((route) => ({
        state: route.state,
        reason: route.ineligibleReason
      }))
    ).toEqual([
      { state: 'terminal_failure', reason: undefined },
      { state: 'delivered', reason: undefined }
    ])
    expect(result.routes.map((route) => route.attempts.length)).toEqual([1, 1])
    expect(result).toMatchObject({
      phase: 'terminal',
      result: 'delivered',
      chargeableDelivery: { routeId: result.routes[1]!.id }
    })
    expect(events).toEqual(['provider:whatsapp', 'provider:sms'])
  })

  it.each([
    'appointment_confirmation',
    'appointment_reminder',
    'appointment_cancellation',
    'appointment_reschedule'
  ] as const)(
    'captures %s deterministically without treating capture as delivery',
    async (purpose) => {
      const intent = prepared(purpose)
      const executionContext = {
        ...context(intent.id),
        facts: {
          ...context(intent.id).facts,
          confirmationUrl:
            purpose === 'appointment_confirmation'
              ? context(intent.id).facts.confirmationUrl
              : ''
        }
      }
      const { aggregate, submit } = await scenario({
        intent,
        executionContext,
        outcomes: [
          {
            _tag: 'captured',
            captureId: `pcap_${purpose}`,
            capturedAt: now
          }
        ]
      })
      expect(submit).toHaveBeenCalledOnce()
      expect(aggregate).toMatchObject({
        phase: 'terminal',
        result: 'not_sent',
        resultReason: 'captured_local'
      })
      expect(aggregate.routes[0]?.evidence[0]?.sourceEventKey).toBe(
        `capture:pcap_${purpose}`
      )
    }
  )

  it('terminates before submission for suppression and insufficient balance', async () => {
    const suppressed = await scenario({
      evaluator: (() =>
        Effect.fail(
          new OperationalMessageIneligible({ reason: 'destination_suppressed' })
        )) as typeof evaluateOperationalMessageEligibility,
      outcomes: []
    })
    expect(suppressed.submit).not.toHaveBeenCalled()
    expect(suppressed.aggregate).toMatchObject({
      phase: 'terminal',
      result: 'not_sent',
      resultReason: 'suppressed'
    })

    const unfunded = await scenario({ availableMilliEuro: 0, outcomes: [] })
    expect(unfunded.submit).not.toHaveBeenCalled()
    expect(unfunded.aggregate).toMatchObject({
      phase: 'terminal',
      result: 'not_sent',
      resultReason: 'insufficient_balance'
    })
  })

  it('retries only when due and fences ambiguous or stale submissions from resubmission', async () => {
    const retry = await scenario({
      executeAt: [now, '2026-07-29T12:00:31.000Z'],
      outcomes: [
        { _tag: 'throttled', retryAfterSeconds: 30 },
        {
          _tag: 'accepted',
          providerReferenceFingerprint: `sha256:${'3'.repeat(64)}`,
          acceptedAt: '2026-07-29T12:00:31.000Z'
        }
      ]
    })
    expect(retry.submit).toHaveBeenCalledTimes(2)
    expect(
      retry.aggregate.routes[0]?.submissionOutcomes.map((item) => item.outcome)
    ).toEqual(['rejected_retryable', 'accepted'])

    const ambiguous = await scenario({
      outcomes: [{ _tag: 'ambiguous', observedAt: now }]
    })
    expect(ambiguous.aggregate).toMatchObject({
      phase: 'awaiting_provider',
      ambiguitySince: now
    })
    expect(ambiguous.aggregate.routes[0]?.state).toBe('submission_unknown')

    const stale = await scenario({
      outcomes: [],
      executeAt: '2026-07-29T12:00:31.000Z',
      beforeExecute: (lifecycle, intent) =>
        Effect.gen(function* () {
          const input = {
            shopId: intent.shopId,
            purpose: intent.purpose,
            locale: intent.locale,
            channel: 'whatsapp' as const,
            provider: 'meta' as const,
            templateVersion: 1,
            destinationFingerprint: intent.recipientSnapshot.fingerprint,
            permission: context(intent.id).permission,
            suppressions: [],
            controls: {
              globalEnabled: true,
              merchantEnabled: true,
              merchantFrozen: false,
              purposeEnabled: true,
              channelEnabled: true,
              providerConfigured: true
            },
            now,
            appointmentStartsAt: context(intent.id).appointmentStartsAt,
            shopTimeZone: context(intent.id).shopTimeZone,
            facts: context(intent.id).facts
          }
          yield* lifecycle.beginRouting({
            intentId: intent.id,
            environment: 'test',
            eligibility: {
              whatsapp: input,
              sms: {
                ...input,
                channel: 'sms',
                provider: 'smso',
                templateVersion: 2
              }
            },
            now
          })
          yield* lifecycle.prepareSubmission({
            intentId: intent.id,
            environment: 'test',
            channel: 'whatsapp',
            eligibility: input,
            requestFingerprint: `sha256:${'4'.repeat(64)}`,
            now
          })
        })
    })
    expect(stale.submit).not.toHaveBeenCalled()
    expect(stale.aggregate.phase).toBe('awaiting_provider')
    expect(stale.aggregate.routes[0]?.state).toBe('submission_unknown')
  })

  it('does no provider work for a superseded intent', async () => {
    const superseded = await scenario({
      outcomes: [],
      beforeExecute: (lifecycle, intent) =>
        lifecycle.supersede({ intentId: intent.id, now })
    })
    expect(superseded.submit).not.toHaveBeenCalled()
    expect(superseded.aggregate).toMatchObject({
      phase: 'terminal',
      result: 'not_sent',
      resultReason: 'superseded'
    })
  })
})
