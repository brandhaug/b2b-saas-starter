import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  NotificationIntentLifecycle,
  SeedNotificationIntentLifecycle,
  type PrepareNotificationIntentInput,
  type SeedNotificationIntentLifecycleOptions
} from './notification-intent-lifecycle.ts'
import {
  OperationalMessageIneligible,
  type OperationalMessageEligibilityInput
} from './controlled-template-eligibility.ts'

const now = '2026-07-29T12:00:00.000Z'
const base: PrepareNotificationIntentInput = {
  id: 'nti_lifecycle',
  shopId: 'shp_lifecycle',
  topic: 'appointment.confirmation',
  sourceType: 'appointment',
  sourceId: 'apt_lifecycle',
  sourceVersion: 3,
  recipientRole: 'customer',
  recipientSnapshot: {
    ciphertext: 'ciphertext:test-customer',
    fingerprint: `sha256:${'1'.repeat(64)}`,
    maskedValue: '+40•••••••456',
    countryCode: 'RO',
    keyVersion: 1
  },
  deduplicationKey: 'confirmation:apt_lifecycle:3',
  purpose: 'appointment_confirmation',
  locale: 'ro',
  availableAt: now,
  createdAt: now
}

const eligibilityFor = (
  channel: 'whatsapp' | 'sms',
  at = now
): OperationalMessageEligibilityInput => ({
  shopId: base.shopId,
  purpose: base.purpose,
  locale: base.locale,
  channel,
  provider: channel === 'whatsapp' ? 'meta' : 'smso',
  templateVersion: channel === 'whatsapp' ? 1 : 2,
  destinationFingerprint: base.recipientSnapshot.fingerprint,
  permission: {
    granted: true,
    destinationFingerprint: base.recipientSnapshot.fingerprint
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
  now: at,
  appointmentStartsAt: '2026-07-30T12:00:00.000Z',
  shopTimeZone: 'Europe/Bucharest',
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

const routingEligibility = (at = now) => ({
  whatsapp: eligibilityFor('whatsapp', at),
  sms: eligibilityFor('sms', at)
})

const seed = (options: SeedNotificationIntentLifecycleOptions = {}) =>
  SeedNotificationIntentLifecycle({
    eligibilityEvaluator: () => Effect.succeed({} as never),
    ...options
  })

const run = <A, E>(
  effect: Effect.Effect<A, E, NotificationIntentLifecycle>,
  layer = seed()
) => Effect.runPromise(effect.pipe(Effect.provide(layer)))

describe('Notification Intent lifecycle', () => {
  it('rechecks authoritative eligibility before writing a submission attempt', async () => {
    const layer = seed({
      eligibilityEvaluator: () =>
        Effect.fail(
          new OperationalMessageIneligible({ reason: 'destination_suppressed' })
        )
    })
    const result = await run(
      Effect.gen(function* () {
        const intents = yield* NotificationIntentLifecycle
        yield* intents.prepare(base)
        yield* intents.beginRouting({
          intentId: base.id,
          environment: 'test',
          eligibility: routingEligibility(),
          now
        })
        const rejected = yield* Effect.result(
          intents.prepareSubmission({
            intentId: base.id,
            channel: 'whatsapp',
            environment: 'test',
            eligibility: eligibilityFor('whatsapp'),
            requestFingerprint: `sha256:${'0'.repeat(64)}`,
            now
          })
        )
        return { rejected, intent: yield* intents.findById(base.id) }
      }),
      layer
    )

    expect(result.rejected).toMatchObject({
      _tag: 'Failure',
      failure: { reason: 'route_not_eligible' }
    })
    expect(result.intent.routes[0]?.attempts).toHaveLength(0)
  })

  it('deduplicates semantic preparation and orders WhatsApp before SMS', async () => {
    const layer = seed()
    const program = Effect.gen(function* () {
      const intents = yield* NotificationIntentLifecycle
      const first = yield* intents.prepare(base)
      const duplicate = yield* intents.prepare({ ...base, id: 'nti_duplicate' })
      return { first, duplicate }
    })

    const { first, duplicate } = await run(program, layer)
    expect(duplicate.id).toBe(first.id)
    expect(first.phase).toBe('ready')
    expect(
      first.routes.map(({ ordinal, channel, provider, state }) => ({
        ordinal,
        channel,
        provider,
        state
      }))
    ).toEqual([
      { ordinal: 0, channel: 'whatsapp', provider: 'meta', state: 'planned' },
      { ordinal: 1, channel: 'sms', provider: 'smso', state: 'planned' }
    ])
  })

  it('allows SMS only after the exact terminal WhatsApp fallback boundary', async () => {
    const layer = seed()
    const program = Effect.gen(function* () {
      const intents = yield* NotificationIntentLifecycle
      yield* intents.prepare(base)
      yield* intents.beginRouting({
        intentId: base.id,
        environment: 'test',
        eligibility: routingEligibility(),
        reservationId: 'mbr_lifecycle',
        rateCardId: 'mrcard_launch_v1',
        chargeMilliEuro: 45,
        now
      })
      const whatsapp = yield* intents.prepareSubmission({
        intentId: base.id,
        channel: 'whatsapp',
        environment: 'test',
        eligibility: eligibilityFor('whatsapp'),
        requestFingerprint: `sha256:${'a'.repeat(64)}`,
        now
      })
      yield* intents.recordSubmissionOutcome({
        intentId: base.id,
        attemptId: whatsapp.attempt.id,
        outcome: 'accepted',
        environment: 'test',
        providerAccountKey: 'test-provider-account',
        sourceEventKey: 'response:test',
        now
      })
      const blocked = yield* Effect.result(
        intents.prepareSubmission({
          intentId: base.id,
          channel: 'sms',
          environment: 'test',
          eligibility: eligibilityFor('sms'),
          requestFingerprint: `sha256:${'b'.repeat(64)}`,
          now
        })
      )
      yield* intents.ingestEvidence({
        id: 'pevd_whatsapp_failed',
        intentId: base.id,
        attemptId: whatsapp.attempt.id,
        environment: 'test',
        providerAccountKey: 'meta_test',
        source: 'callback',
        sourceEventKey: 'meta:event:failed',
        providerReferenceFingerprint: `sha256:${'c'.repeat(64)}`,
        status: 'terminal_failure',
        trusted: true,
        observedAt: '2026-07-29T12:01:00.000Z'
      })
      const sms = yield* intents.prepareSubmission({
        intentId: base.id,
        channel: 'sms',
        environment: 'test',
        eligibility: eligibilityFor('sms', '2026-07-29T12:01:01.000Z'),
        requestFingerprint: `sha256:${'d'.repeat(64)}`,
        now: '2026-07-29T12:01:01.000Z'
      })
      return { blocked, sms, intent: yield* intents.findById(base.id) }
    })

    const result = await run(program, layer)
    expect(result.blocked).toMatchObject({ _tag: 'Failure' })
    expect(result.sms.route.channel).toBe('sms')
    expect(result.intent.routes[0]?.state).toBe('terminal_failure')
    expect(result.intent.routes[1]?.state).toBe('submitting')
  })

  it('does not mistake local console capture for provider acceptance, delivery, or an SMS fallback trigger', async () => {
    const layer = seed()
    const intent = await run(
      Effect.gen(function* () {
        const intents = yield* NotificationIntentLifecycle
        yield* intents.prepare(base)
        yield* intents.beginRouting({
          intentId: base.id,
          environment: 'test',
          eligibility: routingEligibility(),
          reservationId: 'mbr_lifecycle',
          rateCardId: 'mrcard_launch_v1',
          chargeMilliEuro: 45,
          now
        })
        const prepared = yield* intents.prepareSubmission({
          intentId: base.id,
          channel: 'whatsapp',
          environment: 'test',
          eligibility: eligibilityFor('whatsapp'),
          requestFingerprint: `sha256:${'c'.repeat(64)}`,
          now
        })
        return yield* intents.recordSubmissionOutcome({
          intentId: base.id,
          attemptId: prepared.attempt.id,
          outcome: 'captured',
          now
        })
      }),
      layer
    )

    expect(intent).toMatchObject({
      phase: 'terminal',
      result: 'not_sent',
      resultReason: 'captured_local'
    })
    expect(intent.routes[1]?.state).toBe('planned')
    expect(intent.chargeableDelivery).toBeUndefined()
  })

  it('bounds transient retries and creates immutable attempts', async () => {
    const layer = seed({ maxAttemptsPerRoute: 3 })
    const program = Effect.gen(function* () {
      const intents = yield* NotificationIntentLifecycle
      yield* intents.prepare(base)
      yield* intents.beginRouting({
        intentId: base.id,
        environment: 'test',
        eligibility: routingEligibility(),
        reservationId: 'mbr_lifecycle',
        rateCardId: 'mrcard_launch_v1',
        chargeMilliEuro: 45,
        now
      })
      const attemptTimes = [
        '2026-07-29T12:00:00.000Z',
        '2026-07-29T12:01:00.000Z',
        '2026-07-29T12:04:00.000Z'
      ] as const
      for (let ordinal = 0; ordinal < 3; ordinal += 1) {
        const prepared = yield* intents.prepareSubmission({
          intentId: base.id,
          channel: 'whatsapp',
          environment: 'test',
          eligibility: eligibilityFor('whatsapp', attemptTimes[ordinal]!),
          requestFingerprint: `sha256:${String(ordinal).repeat(64)}`,
          now: attemptTimes[ordinal]!
        })
        yield* intents.recordSubmissionOutcome({
          intentId: base.id,
          attemptId: prepared.attempt.id,
          outcome: 'rejected_retryable',
          environment: 'test',
          providerAccountKey: 'test-provider-account',
          sourceEventKey: 'response:test',
          now: new Date(
            new Date(attemptTimes[ordinal]!).getTime() + 1_000
          ).toISOString()
        })
        if (ordinal === 0) {
          const immediate = yield* Effect.result(
            intents.prepareSubmission({
              intentId: base.id,
              channel: 'whatsapp',
              environment: 'test',
              eligibility: eligibilityFor('whatsapp', '2026-07-29T12:00:02.000Z'),
              requestFingerprint: `sha256:${'r'.repeat(64)}`,
              now: '2026-07-29T12:00:02.000Z'
            })
          )
          expect(immediate).toMatchObject({ _tag: 'Failure' })
        }
      }
      return yield* intents.findById(base.id)
    })

    const intent = await run(program, layer)
    expect(intent.routes[0]?.attempts).toHaveLength(3)
    expect(intent.routes[0]?.attempts.map((attempt) => attempt.ordinal)).toEqual([
      0, 1, 2
    ])
    expect(
      intent.routes[0]?.attempts.every((attempt) => attempt.state === 'submitting')
    ).toBe(true)
    expect(intent.routes[0]?.submissionOutcomes).toHaveLength(3)
    expect(intent.routes[0]?.state).toBe('terminal_failure')
    expect(intent.routes[1]?.state).toBe('eligible')
  })

  it('keeps Submission Unknown reconciliation-only and closes ambiguity after seven days without charging', async () => {
    const layer = seed()
    const program = Effect.gen(function* () {
      const intents = yield* NotificationIntentLifecycle
      yield* intents.prepare(base)
      yield* intents.beginRouting({
        intentId: base.id,
        environment: 'test',
        eligibility: routingEligibility(),
        reservationId: 'mbr_lifecycle',
        rateCardId: 'mrcard_launch_v1',
        chargeMilliEuro: 45,
        now
      })
      const prepared = yield* intents.prepareSubmission({
        intentId: base.id,
        channel: 'whatsapp',
        environment: 'test',
        eligibility: eligibilityFor('whatsapp'),
        requestFingerprint: `sha256:${'e'.repeat(64)}`,
        now
      })
      yield* intents.recordSubmissionOutcome({
        intentId: base.id,
        attemptId: prepared.attempt.id,
        outcome: 'submission_unknown',
        environment: 'test',
        providerAccountKey: 'test-provider-account',
        sourceEventKey: 'response:test',
        now
      })
      const retry = yield* Effect.result(
        intents.prepareSubmission({
          intentId: base.id,
          channel: 'whatsapp',
          environment: 'test',
          eligibility: eligibilityFor('whatsapp', '2026-07-30T12:00:00.000Z'),
          requestFingerprint: `sha256:${'f'.repeat(64)}`,
          now: '2026-07-30T12:00:00.000Z'
        })
      )
      const fallback = yield* Effect.result(
        intents.prepareSubmission({
          intentId: base.id,
          channel: 'sms',
          environment: 'test',
          eligibility: eligibilityFor('sms', '2026-07-30T12:00:00.000Z'),
          requestFingerprint: `sha256:${'1'.repeat(64)}`,
          now: '2026-07-30T12:00:00.000Z'
        })
      )
      const early = yield* Effect.result(
        intents.closeExpiredAmbiguity({
          intentId: base.id,
          now: '2026-08-05T11:59:59.999Z'
        })
      )
      const closed = yield* intents.closeExpiredAmbiguity({
        intentId: base.id,
        now: '2026-08-05T12:00:00.000Z'
      })
      return { retry, fallback, early, closed }
    })

    const result = await run(program, layer)
    expect(result.retry).toMatchObject({ _tag: 'Failure' })
    expect(result.fallback).toMatchObject({ _tag: 'Failure' })
    expect(result.early).toMatchObject({ _tag: 'Failure' })
    expect(result.closed).toMatchObject({
      phase: 'terminal',
      result: 'delivery_failed',
      resultReason: 'delivery_unconfirmed',
      reservation: { status: 'released' }
    })
    expect(result.closed.chargeableDelivery).toBeUndefined()
  })

  it('deduplicates and reorders evidence without regression, quarantines contradiction, and charges once', async () => {
    const layer = seed()
    const program = Effect.gen(function* () {
      const intents = yield* NotificationIntentLifecycle
      yield* intents.prepare(base)
      yield* intents.beginRouting({
        intentId: base.id,
        environment: 'test',
        eligibility: routingEligibility(),
        reservationId: 'mbr_lifecycle',
        rateCardId: 'mrcard_launch_v1',
        chargeMilliEuro: 45,
        now
      })
      const prepared = yield* intents.prepareSubmission({
        intentId: base.id,
        channel: 'whatsapp',
        environment: 'test',
        eligibility: eligibilityFor('whatsapp'),
        requestFingerprint: `sha256:${'2'.repeat(64)}`,
        now
      })
      yield* intents.recordSubmissionOutcome({
        intentId: base.id,
        attemptId: prepared.attempt.id,
        outcome: 'accepted',
        environment: 'test',
        providerAccountKey: 'test-provider-account',
        sourceEventKey: 'response:test',
        now
      })
      const delivered = {
        id: 'pevd_delivered',
        intentId: base.id,
        attemptId: prepared.attempt.id,
        environment: 'test',
        providerAccountKey: 'meta_test',
        source: 'callback' as const,
        sourceEventKey: 'meta:event:delivered',
        providerReferenceFingerprint: `sha256:${'3'.repeat(64)}`,
        status: 'delivered' as const,
        trusted: true,
        observedAt: '2026-07-29T12:02:00.000Z'
      }
      yield* intents.ingestEvidence(delivered)
      yield* intents.ingestEvidence({ ...delivered, id: 'pevd_duplicate' })
      yield* intents.ingestEvidence({
        ...delivered,
        id: 'pevd_older_accepted',
        sourceEventKey: 'meta:event:accepted-late',
        status: 'accepted',
        observedAt: '2026-07-29T12:00:30.000Z'
      })
      yield* intents.ingestEvidence({
        ...delivered,
        id: 'pevd_contradiction',
        sourceEventKey: 'meta:event:failed-late',
        status: 'terminal_failure',
        observedAt: '2026-07-29T12:03:00.000Z'
      })
      return yield* intents.findById(base.id)
    })

    const intent = await run(program, layer)
    expect(intent).toMatchObject({ phase: 'terminal', result: 'delivered' })
    expect(intent.routes[0]?.state).toBe('delivered')
    expect(intent.routes[0]?.evidence).toHaveLength(4)
    expect(intent.reconciliationCases).toHaveLength(1)
    expect(intent.chargeableDelivery).toMatchObject({ chargeMilliEuro: 45 })
  })

  it('supersedes safely and creates manual intents idempotently within limits', async () => {
    const layer = seed()
    const program = Effect.gen(function* () {
      const intents = yield* NotificationIntentLifecycle
      yield* intents.prepare(base)
      const old = yield* intents.supersede({ intentId: base.id, now })
      const manualInput = {
        ...base,
        id: 'nti_manual_one',
        sourceVersion: 4,
        deduplicationKey: 'manual:apt_lifecycle:4:command-one',
        manual: { commandKey: 'command-one', actorId: 'usr_owner' },
        createdAt: '2026-07-29T13:00:00.000Z',
        availableAt: '2026-07-29T13:00:00.000Z'
      } as const
      const first = yield* intents.createManual(manualInput)
      const duplicate = yield* intents.createManual({
        ...manualInput,
        id: 'nti_ignored'
      })
      const tooSoon = yield* Effect.result(
        intents.createManual({
          ...manualInput,
          id: 'nti_manual_two',
          deduplicationKey: 'manual:apt_lifecycle:4:command-two',
          manual: { commandKey: 'command-two', actorId: 'usr_owner' },
          createdAt: '2026-07-29T13:04:59.999Z',
          availableAt: '2026-07-29T13:04:59.999Z'
        })
      )
      return { old, first, duplicate, tooSoon }
    })

    const result = await run(program, layer)
    expect(result.old).toMatchObject({
      phase: 'terminal',
      result: 'not_sent',
      resultReason: 'superseded'
    })
    expect(result.duplicate.id).toBe(result.first.id)
    expect(result.tooSoon).toMatchObject({ _tag: 'Failure' })
  })

  it('terminates pre-submission failures without an attempt or charge', async () => {
    const layer = seed()
    const program = Effect.gen(function* () {
      const intents = yield* NotificationIntentLifecycle
      yield* intents.prepare(base)
      return yield* intents.markNotSent({
        intentId: base.id,
        reason: 'insufficient_balance',
        now
      })
    })

    const intent = await run(program, layer)
    expect(intent).toMatchObject({
      phase: 'terminal',
      result: 'not_sent',
      resultReason: 'insufficient_balance'
    })
    expect(intent.routes.every((route) => route.attempts.length === 0)).toBe(true)
    expect(intent.chargeableDelivery).toBeUndefined()
  })

  it('fails closed before routing when financial authority cannot reserve the charge', async () => {
    const layer = seed({
      availableMilliEuroByShop: new Map([[base.shopId, 0]])
    })
    const intent = await run(
      Effect.gen(function* () {
        const intents = yield* NotificationIntentLifecycle
        yield* intents.prepare(base)
        return yield* intents.beginRouting({
          intentId: base.id,
          environment: 'test',
          eligibility: routingEligibility(),
          now
        })
      }),
      layer
    )

    expect(intent).toMatchObject({
      phase: 'terminal',
      result: 'not_sent',
      resultReason: 'insufficient_balance'
    })
    expect(intent.reservation).toBeUndefined()
    expect(intent.routes.every((route) => route.attempts.length === 0)).toBe(true)
  })

  it('rechecks route eligibility before reservation and submission', async () => {
    const layer = seed()
    const program = Effect.gen(function* () {
      const intents = yield* NotificationIntentLifecycle
      yield* intents.prepare(base)
      yield* intents.recordRouteIneligible({
        intentId: base.id,
        channel: 'whatsapp',
        reason: 'whatsapp_suppressed',
        now
      })
      const beforeReservation = yield* intents.findById(base.id)
      yield* intents.beginRouting({
        intentId: base.id,
        environment: 'test',
        eligibility: routingEligibility(),
        reservationId: 'mbr_lifecycle',
        rateCardId: 'mrcard_launch_v1',
        chargeMilliEuro: 45,
        now
      })
      const sms = yield* intents.prepareSubmission({
        intentId: base.id,
        channel: 'sms',
        environment: 'test',
        eligibility: eligibilityFor('sms'),
        requestFingerprint: `sha256:${'4'.repeat(64)}`,
        now
      })
      return { beforeReservation, sms }
    })

    const result = await run(program, layer)
    expect(result.beforeReservation.reservation).toBeUndefined()
    expect(result.beforeReservation.routes.map((route) => route.state)).toEqual([
      'ineligible',
      'eligible'
    ])
    expect(result.sms.attempt.ordinal).toBe(0)
  })

  it('keeps untrusted evidence as an immutable hint without projecting it', async () => {
    const layer = seed()
    const program = Effect.gen(function* () {
      const intents = yield* NotificationIntentLifecycle
      yield* intents.prepare(base)
      yield* intents.recordRouteIneligible({
        intentId: base.id,
        channel: 'whatsapp',
        reason: 'needs_configuration',
        now
      })
      yield* intents.beginRouting({
        intentId: base.id,
        environment: 'test',
        eligibility: routingEligibility(),
        reservationId: 'mbr_lifecycle',
        rateCardId: 'mrcard_launch_v1',
        chargeMilliEuro: 45,
        now
      })
      const sms = yield* intents.prepareSubmission({
        intentId: base.id,
        channel: 'sms',
        environment: 'test',
        eligibility: eligibilityFor('sms'),
        requestFingerprint: `sha256:${'5'.repeat(64)}`,
        now
      })
      yield* intents.recordSubmissionOutcome({
        intentId: base.id,
        attemptId: sms.attempt.id,
        outcome: 'accepted',
        environment: 'test',
        providerAccountKey: 'test-provider-account',
        sourceEventKey: 'response:test',
        now
      })
      return yield* intents.ingestEvidence({
        id: 'pevd_smso_hint',
        intentId: base.id,
        attemptId: sms.attempt.id,
        environment: 'test',
        providerAccountKey: 'smso_test',
        source: 'callback',
        sourceEventKey: 'smso:hint:failed',
        status: 'terminal_failure',
        trusted: true,
        observedAt: '2026-07-29T12:02:00.000Z'
      })
    })

    const intent = await run(program, layer)
    expect(intent.phase).toBe('awaiting_provider')
    expect(intent.routes[1]?.state).toBe('accepted')
    expect(intent.routes[1]?.evidence).toHaveLength(2)
    expect(
      intent.routes[1]?.evidence.find((evidence) => evidence.source === 'callback')
        ?.trusted
    ).toBe(false)
  })

  it('continues reconciliation after post-submission supersession and never adds a second charge', async () => {
    const layer = seed()
    const program = Effect.gen(function* () {
      const intents = yield* NotificationIntentLifecycle
      yield* intents.prepare(base)
      yield* intents.beginRouting({
        intentId: base.id,
        environment: 'test',
        eligibility: routingEligibility(),
        reservationId: 'mbr_lifecycle',
        rateCardId: 'mrcard_launch_v1',
        chargeMilliEuro: 45,
        now
      })
      const whatsapp = yield* intents.prepareSubmission({
        intentId: base.id,
        channel: 'whatsapp',
        environment: 'test',
        eligibility: eligibilityFor('whatsapp'),
        requestFingerprint: `sha256:${'6'.repeat(64)}`,
        now
      })
      yield* intents.recordSubmissionOutcome({
        intentId: base.id,
        attemptId: whatsapp.attempt.id,
        outcome: 'accepted',
        environment: 'test',
        providerAccountKey: 'test-provider-account',
        sourceEventKey: 'response:test',
        now
      })
      const superseded = yield* intents.supersede({
        intentId: base.id,
        now: '2026-07-29T12:01:00.000Z'
      })
      const blockedRetry = yield* Effect.result(
        intents.prepareSubmission({
          intentId: base.id,
          channel: 'whatsapp',
          environment: 'test',
          eligibility: eligibilityFor('whatsapp', '2026-07-29T12:01:01.000Z'),
          requestFingerprint: `sha256:${'7'.repeat(64)}`,
          now: '2026-07-29T12:01:01.000Z'
        })
      )
      const delivered = yield* intents.ingestEvidence({
        id: 'pevd_superseded_delivered',
        intentId: base.id,
        attemptId: whatsapp.attempt.id,
        environment: 'test',
        providerAccountKey: 'meta_test',
        source: 'callback',
        sourceEventKey: 'meta:superseded:delivered',
        status: 'delivered',
        trusted: true,
        observedAt: '2026-07-29T12:02:00.000Z'
      })
      return { superseded, blockedRetry, delivered }
    })

    const result = await run(program, layer)
    expect(result.superseded.supersededAfterSubmission).toBe(true)
    expect(result.blockedRetry).toMatchObject({ _tag: 'Failure' })
    expect(result.delivered).toMatchObject({
      phase: 'terminal',
      result: 'delivered',
      supersededAfterSubmission: true
    })
    expect(result.delivered.chargeableDelivery).toBeDefined()
  })

  it('never activates fallback after post-submission supersession', async () => {
    const layer = seed()
    const intent = await run(
      Effect.gen(function* () {
        const intents = yield* NotificationIntentLifecycle
        yield* intents.prepare(base)
        yield* intents.beginRouting({
          intentId: base.id,
          environment: 'test',
          eligibility: routingEligibility(),
          now
        })
        const prepared = yield* intents.prepareSubmission({
          intentId: base.id,
          channel: 'whatsapp',
          environment: 'test',
          eligibility: eligibilityFor('whatsapp'),
          requestFingerprint: `sha256:${'s'.repeat(64)}`,
          now
        })
        yield* intents.recordSubmissionOutcome({
          intentId: base.id,
          attemptId: prepared.attempt.id,
          outcome: 'accepted',
          environment: 'test',
          providerAccountKey: 'test-provider-account',
          sourceEventKey: 'response:test',
          now
        })
        yield* intents.supersede({
          intentId: base.id,
          now: '2026-07-29T12:01:00.000Z'
        })
        return yield* intents.ingestEvidence({
          id: 'pevd_superseded_terminal',
          intentId: base.id,
          attemptId: prepared.attempt.id,
          environment: 'test',
          providerAccountKey: 'meta_test',
          source: 'callback',
          sourceEventKey: 'meta:superseded:terminal',
          status: 'terminal_failure',
          trusted: true,
          observedAt: '2026-07-29T12:02:00.000Z'
        })
      }),
      layer
    )

    expect(intent.supersededAfterSubmission).toBe(true)
    expect(intent.routes[0]?.state).toBe('terminal_failure')
    expect(intent.routes[1]?.state).toBe('planned')
  })

  it('keeps a terminal Not Sent result immutable when late delivery evidence arrives', async () => {
    const layer = seed()
    const result = await run(
      Effect.gen(function* () {
        const intents = yield* NotificationIntentLifecycle
        yield* intents.prepare(base)
        yield* intents.beginRouting({
          intentId: base.id,
          environment: 'test',
          eligibility: routingEligibility(),
          now
        })
        const prepared = yield* intents.prepareSubmission({
          intentId: base.id,
          channel: 'whatsapp',
          environment: 'test',
          eligibility: eligibilityFor('whatsapp'),
          requestFingerprint: `sha256:${'t'.repeat(64)}`,
          now
        })
        yield* intents.recordSubmissionOutcome({
          intentId: base.id,
          attemptId: prepared.attempt.id,
          outcome: 'captured',
          now
        })
        return yield* intents.ingestEvidence({
          id: 'pevd_after_capture',
          intentId: base.id,
          attemptId: prepared.attempt.id,
          environment: 'test',
          providerAccountKey: 'meta_test',
          source: 'operator',
          sourceEventKey: 'operator:late-delivery',
          status: 'delivered',
          trusted: true,
          observedAt: '2026-07-29T12:03:00.000Z'
        })
      }),
      layer
    )

    expect(result).toMatchObject({
      phase: 'terminal',
      result: 'not_sent',
      resultReason: 'captured_local'
    })
    expect(result.chargeableDelivery).toBeUndefined()
    expect(result.reconciliationCases).toHaveLength(1)
  })

  it('projects every non-conflicting evidence ordering monotonically to Delivered', async () => {
    const permutations = [
      ['accepted', 'delivered', 'read'],
      ['accepted', 'read', 'delivered'],
      ['delivered', 'accepted', 'read'],
      ['delivered', 'read', 'accepted'],
      ['read', 'accepted', 'delivered'],
      ['read', 'delivered', 'accepted']
    ] as const

    for (const [caseIndex, statuses] of permutations.entries()) {
      const input = {
        ...base,
        id: `nti_property_${caseIndex}`,
        deduplicationKey: `property:${caseIndex}`
      }
      const result = await run(
        Effect.gen(function* () {
          const intents = yield* NotificationIntentLifecycle
          yield* intents.prepare(input)
          yield* intents.beginRouting({
            intentId: input.id,
            environment: 'test',
            eligibility: routingEligibility(),
            reservationId: `mbr_property_${caseIndex}`,
            rateCardId: 'mrcard_launch_v1',
            chargeMilliEuro: 45,
            now
          })
          const prepared = yield* intents.prepareSubmission({
            intentId: input.id,
            channel: 'whatsapp',
            environment: 'test',
            eligibility: eligibilityFor('whatsapp'),
            requestFingerprint: `sha256:${String(caseIndex).repeat(64)}`,
            now
          })
          for (const [evidenceIndex, status] of statuses.entries())
            yield* intents.ingestEvidence({
              id: `pevd_property_${caseIndex}_${evidenceIndex}`,
              intentId: input.id,
              attemptId: prepared.attempt.id,
              environment: 'test',
              providerAccountKey: 'meta_test',
              source: 'callback',
              sourceEventKey: `property:${caseIndex}:${evidenceIndex}`,
              status,
              trusted: true,
              observedAt: `2026-07-29T12:0${evidenceIndex}:00.000Z`
            })
          return yield* intents.findById(input.id)
        }),
        seed()
      )
      expect(result.result).toBe('delivered')
      expect(result.routes[0]?.state).toBe('delivered')
      expect(result.chargeableDelivery).toBeDefined()
    }
  })

  it('absorbs a contradictory second-provider delivery behind one Chargeable Delivery', async () => {
    const layer = seed()
    const result = await run(
      Effect.gen(function* () {
        const intents = yield* NotificationIntentLifecycle
        yield* intents.prepare(base)
        yield* intents.beginRouting({
          intentId: base.id,
          environment: 'test',
          eligibility: routingEligibility(),
          reservationId: 'mbr_lifecycle',
          rateCardId: 'mrcard_launch_v1',
          chargeMilliEuro: 45,
          now
        })
        const whatsapp = yield* intents.prepareSubmission({
          intentId: base.id,
          channel: 'whatsapp',
          environment: 'test',
          eligibility: eligibilityFor('whatsapp'),
          requestFingerprint: `sha256:${'8'.repeat(64)}`,
          now
        })
        yield* intents.recordSubmissionOutcome({
          intentId: base.id,
          attemptId: whatsapp.attempt.id,
          outcome: 'accepted',
          environment: 'test',
          providerAccountKey: 'test-provider-account',
          sourceEventKey: 'response:test',
          now
        })
        yield* intents.ingestEvidence({
          id: 'pevd_whatsapp_terminal',
          intentId: base.id,
          attemptId: whatsapp.attempt.id,
          environment: 'test',
          providerAccountKey: 'meta_test',
          source: 'callback',
          sourceEventKey: 'meta:terminal',
          status: 'terminal_failure',
          trusted: true,
          observedAt: '2026-07-29T12:01:00.000Z'
        })
        const sms = yield* intents.prepareSubmission({
          intentId: base.id,
          channel: 'sms',
          environment: 'test',
          eligibility: eligibilityFor('sms', '2026-07-29T12:01:01.000Z'),
          requestFingerprint: `sha256:${'9'.repeat(64)}`,
          now: '2026-07-29T12:01:01.000Z'
        })
        yield* intents.recordSubmissionOutcome({
          intentId: base.id,
          attemptId: sms.attempt.id,
          outcome: 'accepted',
          environment: 'test',
          providerAccountKey: 'test-provider-account',
          sourceEventKey: 'response:test',
          now: '2026-07-29T12:01:02.000Z'
        })
        const smsDelivered = yield* intents.ingestEvidence({
          id: 'pevd_sms_delivered',
          intentId: base.id,
          attemptId: sms.attempt.id,
          environment: 'test',
          providerAccountKey: 'smso_test',
          source: 'query',
          sourceEventKey: 'smso:delivered',
          status: 'delivered',
          trusted: true,
          observedAt: '2026-07-29T12:02:00.000Z'
        })
        const afterContradiction = yield* intents.ingestEvidence({
          id: 'pevd_whatsapp_late_delivered',
          intentId: base.id,
          attemptId: whatsapp.attempt.id,
          environment: 'test',
          providerAccountKey: 'meta_test',
          source: 'callback',
          sourceEventKey: 'meta:late-delivered',
          status: 'delivered',
          trusted: true,
          observedAt: '2026-07-29T12:03:00.000Z'
        })
        return { smsDelivered, afterContradiction }
      }),
      layer
    )

    expect(result.afterContradiction.chargeableDelivery?.id).toBe(
      result.smsDelivered.chargeableDelivery?.id
    )
    expect(result.afterContradiction.chargeableDelivery?.routeId).toContain('_sms')
    expect(result.afterContradiction.reconciliationCases).toHaveLength(1)
  })

  it('allows three spaced manual intents per day and rejects the fourth', async () => {
    const layer = seed()
    const result = await run(
      Effect.gen(function* () {
        const intents = yield* NotificationIntentLifecycle
        for (let index = 0; index < 3; index += 1) {
          const timestamp = `2026-07-29T15:${String(index * 5).padStart(2, '0')}:00.000Z`
          yield* intents.createManual({
            ...base,
            id: `nti_daily_${index}`,
            deduplicationKey: `ignored:${index}`,
            manual: { commandKey: `daily-${index}`, actorId: 'usr_owner' },
            createdAt: timestamp,
            availableAt: timestamp
          })
        }
        return yield* Effect.result(
          intents.createManual({
            ...base,
            id: 'nti_daily_four',
            deduplicationKey: 'ignored:four',
            manual: { commandKey: 'daily-four', actorId: 'usr_owner' },
            createdAt: '2026-07-29T15:15:00.000Z',
            availableAt: '2026-07-29T15:15:00.000Z'
          })
        )
      }),
      layer
    )

    expect(result).toMatchObject({ _tag: 'Failure' })
  })
})
