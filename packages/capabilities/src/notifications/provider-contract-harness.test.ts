import { Effect, Logger, Redacted, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  ProviderContractFailure,
  ProviderCallbackOutcome,
  ProviderCallbackVerification,
  ProviderCaptureRecord,
  ProviderCostFact,
  ProviderCostReader,
  ProviderEvidence,
  ProviderQuery,
  ProviderQueryOutcome,
  ProviderQueueWakeup,
  ProviderSubmission,
  ProviderSubmissionRequest,
  ProviderSubmissionOutcome
} from './provider-contracts.ts'
import {
  makeDeterministicProviderHarness,
  providerContractFixtures
} from './provider-contract-testing.ts'

describe('deterministic provider contract harness', () => {
  it('captures a Meta request locally without leaking protected material', async () => {
    const harness = makeDeterministicProviderHarness({
      runtime: 'local',
      provider: 'meta'
    })

    const request = {
      ...providerContractFixtures.requests.roConfirmation,
      destination: Redacted.make('+40722123456'),
      renderedBody: Redacted.make(
        'Programarea ta este confirmată: https://example.test/confirmation?token=confirmation-capability'
      ),
      credential: Redacted.make('meta-production-credential')
    }
    const outcome = await Effect.runPromise(
      Effect.flatMap(ProviderSubmission, (provider) => provider.submit(request)).pipe(
        Effect.provide(harness.layer)
      )
    )

    expect(outcome).toEqual({
      _tag: 'captured',
      captureId: 'pcap_0001',
      capturedAt: '2026-07-29T09:00:00.000Z'
    })
    expect(harness.captures()).toEqual([
      {
        captureId: 'pcap_0001',
        capturedAt: '2026-07-29T09:00:00.000Z',
        provider: 'meta',
        channel: 'whatsapp',
        locale: 'ro',
        purpose: 'appointment_confirmation',
        templateVersion: 'v1',
        attemptId: 'pat_fixture_ro_confirmation',
        intentId: 'nti_fixture_ro_confirmation',
        destination: '+40•••••••456',
        bodyFingerprint:
          'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
      }
    ])
    expect(() =>
      Schema.decodeUnknownSync(ProviderCaptureRecord)({
        ...harness.captures()[0],
        destination: '+40722123456'
      })
    ).toThrow()

    const serializedLogs = JSON.stringify(harness.logs())
    for (const protectedValue of [
      '+40722123456',
      'confirmation-capability',
      'meta-production-credential',
      'provider-reference',
      'Programarea ta este confirmată'
    ])
      expect(serializedLogs).not.toContain(protectedValue)
  })

  it('validates every reusable outcome and evidence fixture', () => {
    for (const outcome of Object.values(providerContractFixtures.submissions))
      expect(() =>
        Schema.decodeUnknownSync(ProviderSubmissionOutcome)(outcome)
      ).not.toThrow()

    expect(
      Schema.decodeUnknownSync(ProviderContractFailure)(
        providerContractFixtures.failures.timeout
      ).reason
    ).toBe('timeout')
    expect(() =>
      Schema.decodeUnknownSync(ProviderContractFailure)({
        ...providerContractFixtures.failures.timeout,
        code: 'upstream said credential-secret'
      })
    ).toThrow()

    for (const evidence of [
      providerContractFixtures.evidence.delivery,
      providerContractFixtures.evidence.terminalFailure,
      ...providerContractFixtures.evidence.duplicate,
      ...providerContractFixtures.evidence.reordered,
      ...providerContractFixtures.evidence.contradictory
    ])
      expect(() => Schema.decodeUnknownSync(ProviderEvidence)(evidence)).not.toThrow()

    for (const [provider, channel] of [
      ['meta', 'sms'],
      ['smso', 'whatsapp']
    ] as const)
      expect(() =>
        Schema.decodeUnknownSync(ProviderSubmissionRequest)({
          ...providerContractFixtures.requests.roConfirmation,
          provider,
          channel,
          destination: Redacted.make('+40722123456'),
          renderedBody: Redacted.make('safe test input')
        })
      ).toThrow()

    for (const callback of Object.values(providerContractFixtures.callbacks))
      expect(() =>
        Schema.decodeUnknownSync(ProviderCallbackOutcome)(callback)
      ).not.toThrow()
    for (const query of Object.values(providerContractFixtures.queries))
      expect(() => Schema.decodeUnknownSync(ProviderQueryOutcome)(query)).not.toThrow()
    for (const cost of Object.values(providerContractFixtures.costs))
      expect(() => Schema.decodeUnknownSync(ProviderCostFact)(cost)).not.toThrow()

    expect(
      Schema.decodeUnknownSync(ProviderQueueWakeup)(
        providerContractFixtures.queueWakeup
      )
    ).toEqual(providerContractFixtures.queueWakeup)
  })

  it('captures SMSO.ro only in explicit local/test runtimes', async () => {
    const testHarness = makeDeterministicProviderHarness({
      runtime: 'test',
      provider: 'smso',
      now: '2026-07-29T10:00:00.000Z'
    })
    const request = {
      ...providerContractFixtures.requests.enReminder,
      destination: Redacted.make('+40733111222'),
      renderedBody: Redacted.make('Reminder for your appointment'),
      credential: Redacted.make('smso-production-credential')
    }

    await expect(Effect.runPromise(testHarness.submit(request))).resolves.toEqual({
      _tag: 'captured',
      captureId: 'pcap_0001',
      capturedAt: '2026-07-29T10:00:00.000Z'
    })
    expect(testHarness.captures()[0]).toMatchObject({
      provider: 'smso',
      channel: 'sms',
      locale: 'en',
      destination: '+40•••••••222'
    })
    const providerOperations = await Effect.runPromise(
      Effect.gen(function* () {
        const callbacks = yield* ProviderCallbackVerification
        const queries = yield* ProviderQuery
        const costs = yield* ProviderCostReader
        return {
          callback: yield* callbacks.verify({
            provider: 'smso',
            receivedAt: '2026-07-29T10:00:00.000Z',
            rawBody: Redacted.make('raw callback fixture')
          }),
          query: yield* queries.query({
            provider: 'smso',
            attemptId: 'pat_fixture_en_reminder',
            intentId: 'nti_fixture_en_reminder',
            providerReference: Redacted.make('raw provider reference fixture'),
            providerReferenceFingerprint:
              'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
          }),
          costs: yield* costs.read('pat_fixture_en_reminder')
        }
      }).pipe(Effect.provide(testHarness.layer))
    )
    expect(providerOperations).toEqual({
      callback: providerContractFixtures.callbacks.smsoHint,
      query: providerContractFixtures.queries.smsoTerminalFailure,
      costs: [providerContractFixtures.costs.smso]
    })

    for (const runtime of ['preview', 'production'] as const) {
      const harness = makeDeterministicProviderHarness({
        runtime,
        provider: 'smso'
      })
      const failure = await Effect.runPromise(Effect.flip(harness.submit(request)))
      expect(failure).toBeInstanceOf(ProviderContractFailure)
      expect(failure.reason).toBe('needs_configuration')
      expect(harness.runtimeState).toBe('needs_configuration')
      expect(harness.captures()).toEqual([])
      expect(harness.logs()).toEqual([])
    }
  })

  it('keeps fixtures, capture logs, and queue-shaped data free of protected values', async () => {
    const harness = makeDeterministicProviderHarness({
      runtime: 'test',
      provider: 'meta'
    })
    const effectLogs: unknown[] = []
    const logger = Logger.make((options) => effectLogs.push(options.message))
    await Effect.runPromise(
      harness
        .submit({
          ...providerContractFixtures.requests.roConfirmation,
          destination: Redacted.make('+40744999888'),
          renderedBody: Redacted.make(
            'Mesaj complet https://example.test/c?token=confirmation-secret'
          ),
          credential: Redacted.make('credential-secret')
        })
        .pipe(Effect.provide(Logger.layer([logger])))
    )
    const invalidFingerprint = await Effect.runPromise(
      Effect.flip(
        harness.submit({
          ...providerContractFixtures.requests.roConfirmation,
          destination: Redacted.make('+40744999888'),
          renderedBody: Redacted.make('Mesaj complet'),
          bodyFingerprint: 'Mesaj complet'
        })
      )
    )
    expect(invalidFingerprint.code).toBe('malformed_provider_evidence')

    const serializedSafeData = JSON.stringify({
      fixtures: providerContractFixtures,
      captures: harness.captures(),
      logs: harness.logs(),
      effectLogs,
      queue: providerContractFixtures.queueWakeup
    })
    for (const protectedValue of [
      '+40744999888',
      'confirmation-secret',
      'credential-secret',
      'raw-provider-reference',
      'Mesaj complet'
    ])
      expect(serializedSafeData).not.toContain(protectedValue)
  })
})
