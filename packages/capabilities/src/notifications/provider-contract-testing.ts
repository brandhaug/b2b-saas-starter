import { Effect, Layer, Redacted } from 'effect'
import type {
  ProviderCaptureRecord,
  ProviderSubmissionRequest
} from './provider-contracts.ts'
import {
  ProviderContractFailure,
  type ProviderRuntime,
  type ProviderRuntimeState,
  ProviderSubmission
} from './provider-contracts.ts'

type SubmissionRequest = typeof ProviderSubmissionRequest.Type
type CaptureRecord = typeof ProviderCaptureRecord.Type
type Provider = SubmissionRequest['provider']

const FIXED_NOW = '2026-07-29T09:00:00.000Z'
const DELIVERY_EVIDENCE = {
  evidenceId: 'pevd_fixture_delivery',
  attemptId: 'pat_fixture_ro_confirmation',
  intentId: 'nti_fixture_ro_confirmation',
  provider: 'meta',
  source: 'callback',
  status: 'delivered',
  observedAt: FIXED_NOW,
  providerOccurredAt: '2026-07-29T08:59:58.000Z',
  providerReferenceFingerprint: 'prefp_fixture_delivery',
  trusted: true
} as const
const TERMINAL_FAILURE_EVIDENCE = {
  evidenceId: 'pevd_fixture_terminal_failure',
  attemptId: 'pat_fixture_en_reminder',
  intentId: 'nti_fixture_en_reminder',
  provider: 'smso',
  source: 'query',
  status: 'terminal_failure',
  observedAt: FIXED_NOW,
  providerOccurredAt: '2026-07-29T08:59:57.000Z',
  providerReferenceFingerprint: 'prefp_fixture_terminal_failure',
  trusted: true,
  code: 'provider_terminal_failure'
} as const
const EARLIER_ACCEPTANCE_EVIDENCE = {
  evidenceId: 'pevd_fixture_acceptance',
  attemptId: 'pat_fixture_ro_confirmation',
  intentId: 'nti_fixture_ro_confirmation',
  provider: 'meta',
  source: 'callback',
  status: 'accepted',
  observedAt: '2026-07-29T09:00:01.000Z',
  providerOccurredAt: '2026-07-29T08:59:55.000Z',
  providerReferenceFingerprint: 'prefp_fixture_delivery',
  trusted: true
} as const
const CONTRADICTORY_FAILURE_EVIDENCE = {
  ...DELIVERY_EVIDENCE,
  evidenceId: 'pevd_fixture_contradictory_failure',
  status: 'terminal_failure',
  observedAt: '2026-07-29T09:00:02.000Z',
  code: 'contradictory_terminal_failure'
} as const

export const providerContractFixtures = {
  requests: {
    roConfirmation: {
      attemptId: 'pat_fixture_ro_confirmation',
      intentId: 'nti_fixture_ro_confirmation',
      routeId: 'prt_fixture_ro_confirmation',
      provider: 'meta',
      channel: 'whatsapp',
      locale: 'ro',
      purpose: 'appointment_confirmation',
      templateVersion: 'v1',
      idempotencyKey: 'idem_fixture_ro_confirmation',
      bodyFingerprint: 'body_fixture_ro_confirmation'
    },
    enReminder: {
      attemptId: 'pat_fixture_en_reminder',
      intentId: 'nti_fixture_en_reminder',
      routeId: 'prt_fixture_en_reminder',
      provider: 'smso',
      channel: 'sms',
      locale: 'en',
      purpose: 'appointment_reminder',
      templateVersion: 'v1',
      idempotencyKey: 'idem_fixture_en_reminder',
      bodyFingerprint: 'body_fixture_en_reminder'
    }
  },
  submissions: {
    acceptance: {
      _tag: 'accepted',
      providerReferenceFingerprint: 'prefp_fixture_accepted',
      acceptedAt: FIXED_NOW
    },
    rejection: {
      _tag: 'rejected',
      classification: 'terminal',
      code: 'provider_rejected'
    },
    throttling: {
      _tag: 'throttled',
      retryAfterSeconds: 30
    },
    ambiguousSubmission: {
      _tag: 'ambiguous',
      observedAt: FIXED_NOW
    }
  },
  failures: {
    timeout: {
      _tag: 'ProviderContractFailure',
      provider: 'meta',
      operation: 'submit',
      reason: 'timeout',
      code: 'provider_timeout'
    }
  },
  evidence: {
    delivery: DELIVERY_EVIDENCE,
    terminalFailure: TERMINAL_FAILURE_EVIDENCE,
    duplicate: [DELIVERY_EVIDENCE, DELIVERY_EVIDENCE],
    reordered: [DELIVERY_EVIDENCE, EARLIER_ACCEPTANCE_EVIDENCE],
    contradictory: [DELIVERY_EVIDENCE, CONTRADICTORY_FAILURE_EVIDENCE]
  },
  callbacks: {
    metaDelivery: {
      _tag: 'verified',
      evidence: [DELIVERY_EVIDENCE]
    },
    smsoHint: {
      _tag: 'untrusted_hint',
      providerReferenceFingerprint: 'prefp_fixture_terminal_failure'
    },
    rejected: {
      _tag: 'rejected',
      code: 'invalid_signature'
    }
  },
  queries: {
    delivery: {
      _tag: 'evidence',
      evidence: DELIVERY_EVIDENCE
    },
    notFound: {
      _tag: 'not_found'
    },
    throttled: {
      _tag: 'throttled',
      retryAfterSeconds: 30
    }
  },
  costs: {
    meta: {
      costFactId: 'pcst_fixture_meta',
      attemptId: 'pat_fixture_ro_confirmation',
      intentId: 'nti_fixture_ro_confirmation',
      provider: 'meta',
      amountMilliEuro: 7,
      currency: 'EUR',
      units: 1,
      recordedAt: FIXED_NOW,
      source: 'query'
    },
    smso: {
      costFactId: 'pcst_fixture_smso',
      attemptId: 'pat_fixture_en_reminder',
      intentId: 'nti_fixture_en_reminder',
      provider: 'smso',
      amountMilliEuro: 32,
      currency: 'EUR',
      units: 1,
      recordedAt: FIXED_NOW,
      source: 'invoice'
    }
  },
  queueWakeup: {
    version: 1,
    kind: 'notification-intent',
    intentId: 'nti_fixture_ro_confirmation'
  }
} as const

const maskDestination = (destination: Redacted.Redacted<string>) => {
  const value = Redacted.value(destination)
  return `${value.slice(0, 3)}•••••••${value.slice(-3)}`
}

export const makeDeterministicProviderHarness = (options: {
  readonly runtime: ProviderRuntime
  readonly provider: Provider
  readonly now?: string
}) => {
  const captureRecords: CaptureRecord[] = []
  const logRecords: Readonly<Record<string, unknown>>[] = []
  let nextCapture = 1
  const runtimeState: ProviderRuntimeState =
    options.runtime === 'local' || options.runtime === 'test'
      ? 'capture'
      : 'needs_configuration'

  const submit = (
    request: SubmissionRequest
  ): Effect.Effect<
    {
      readonly _tag: 'captured'
      readonly captureId: string
      readonly capturedAt: string
    },
    ProviderContractFailure
  > =>
    Effect.gen(function* () {
      if (runtimeState === 'needs_configuration')
        return yield* new ProviderContractFailure({
          provider: options.provider,
          operation: 'submit',
          reason: 'needs_configuration',
          code: 'provider_not_configured'
        })
      if (request.provider !== options.provider)
        return yield* new ProviderContractFailure({
          provider: options.provider,
          operation: 'submit',
          reason: 'malformed_evidence',
          code: 'provider_mismatch'
        })
      const captureId = `pcap_${String(nextCapture++).padStart(4, '0')}`
      const capturedAt = options.now ?? FIXED_NOW
      const capture: CaptureRecord = {
        captureId,
        capturedAt,
        provider: request.provider,
        channel: request.channel,
        locale: request.locale,
        purpose: request.purpose,
        templateVersion: request.templateVersion,
        attemptId: request.attemptId,
        intentId: request.intentId,
        destination: maskDestination(request.destination),
        bodyFingerprint: request.bodyFingerprint
      }
      captureRecords.push(capture)
      logRecords.push({
        event: 'operational-messaging.provider.captured',
        ...capture
      })
      yield* Effect.log('operational-messaging.provider.captured', capture)
      return { _tag: 'captured' as const, captureId, capturedAt }
    })

  return {
    runtimeState,
    submit,
    layer: Layer.succeed(ProviderSubmission)({ submit }),
    captures: () => [...captureRecords],
    logs: () => [...logRecords]
  }
}
