import { Context, Effect, Layer, Redacted } from 'effect'
import { CapabilityUnavailable } from '../errors.ts'
import {
  ControlledTemplateEligibilityEngine,
  type ControlledTemplateFacts,
  type OperationalMessageEligibilityInput
} from './controlled-template-eligibility.ts'
import {
  NotificationIntentLifecycle,
  type NotificationIntentAggregate,
  type NotificationIntentRejected
} from './notification-intent-lifecycle.ts'
import { ProviderSubmission } from './provider-contracts.ts'

export type NotificationIntentExecutionContext = {
  readonly intentId: string
  readonly appointmentStartsAt: string
  readonly shopTimeZone: string
  readonly permission: {
    readonly granted: boolean
    readonly destinationFingerprint: string
  }
  readonly facts: ControlledTemplateFacts
}

export type NotificationIntentExecutionStoreShape = {
  readonly load: (
    intentId: string
  ) => Effect.Effect<NotificationIntentExecutionContext, CapabilityUnavailable>
  readonly discoverDue: (input: {
    readonly now: string
    readonly limit: number
    readonly perShopLimit: number
  }) => Effect.Effect<readonly string[], CapabilityUnavailable>
}

export class NotificationIntentExecutionStore extends Context.Service<
  NotificationIntentExecutionStore,
  NotificationIntentExecutionStoreShape
>()('@b2b-saas-starter/capabilities/notifications/NotificationIntentExecutionStore') {}

type ExecutionError = NotificationIntentRejected | CapabilityUnavailable

export type NotificationIntentExecutionShape = {
  readonly execute: (input: {
    readonly intentId: string
    readonly now: string
  }) => Effect.Effect<void, ExecutionError>
  readonly discoverDue: (input: {
    readonly now: string
    readonly limit?: number
    readonly perShopLimit?: number
  }) => Effect.Effect<readonly string[], CapabilityUnavailable>
}

export class NotificationIntentExecution extends Context.Service<
  NotificationIntentExecution,
  NotificationIntentExecutionShape
>()('@b2b-saas-starter/capabilities/notifications/NotificationIntentExecution') {}

const providerRouteId = (routeId: string) => `prt_${routeId.replace(/^[^_]+_/, '')}`
const providerIdempotencyKey = (attemptId: string) => `idem_${attemptId}`
const staleSubmissionMilliseconds = 30_000

const eligibilityFor = (
  intent: NotificationIntentAggregate,
  execution: NotificationIntentExecutionContext,
  channel: 'whatsapp' | 'sms',
  now: string,
  providerConfigured: boolean
): OperationalMessageEligibilityInput => ({
  shopId: intent.shopId,
  purpose: intent.purpose,
  locale: intent.locale,
  channel,
  provider: channel === 'whatsapp' ? 'meta' : 'smso',
  templateVersion: channel === 'whatsapp' ? 1 : 2,
  destinationFingerprint: intent.recipientSnapshot.fingerprint,
  permission: execution.permission,
  suppressions: [],
  controls: {
    globalEnabled: true,
    merchantEnabled: true,
    merchantFrozen: false,
    purposeEnabled: true,
    channelEnabled: true,
    providerConfigured
  },
  now,
  appointmentStartsAt: execution.appointmentStartsAt,
  shopTimeZone: execution.shopTimeZone,
  facts: execution.facts
})

export const makeNotificationIntentExecutionLayer = (options: {
  readonly environment: string
  readonly providerAccountKeys: { readonly meta: string; readonly smso: string }
  readonly providerConfigured?: {
    readonly meta: boolean
    readonly smso: boolean
  }
  readonly destinationConfigured?: boolean
  readonly revealDestination: (
    ciphertext: string,
    keyVersion: number
  ) => Effect.Effect<Redacted.Redacted<string>, CapabilityUnavailable>
}): Layer.Layer<
  NotificationIntentExecution,
  never,
  | NotificationIntentExecutionStore
  | NotificationIntentLifecycle
  | ControlledTemplateEligibilityEngine
  | ProviderSubmission
> =>
  Layer.effect(
    NotificationIntentExecution,
    Effect.gen(function* () {
      const store = yield* NotificationIntentExecutionStore
      const lifecycle = yield* NotificationIntentLifecycle
      const eligibility = yield* ControlledTemplateEligibilityEngine
      const provider = yield* ProviderSubmission
      const configured = options.providerConfigured ?? { meta: true, smso: true }

      const durableOutcome = (
        intentId: string,
        attemptId: string,
        now: string,
        outcome:
          | 'captured'
          | 'accepted'
          | 'rejected_retryable'
          | 'rejected_terminal'
          | 'submission_unknown',
        providerName: 'meta' | 'smso',
        details: {
          readonly providerReferenceFingerprint?: string
          readonly sourceEventKey?: string
        } = {}
      ) =>
        outcome === 'captured'
          ? lifecycle.recordSubmissionOutcome({
              intentId,
              attemptId,
              outcome,
              now
            })
          : lifecycle.recordSubmissionOutcome({
              intentId,
              attemptId,
              outcome,
              now,
              environment: options.environment,
              providerAccountKey: options.providerAccountKeys[providerName],
              sourceEventKey:
                details.sourceEventKey ?? `response:${attemptId}:${outcome}`,
              ...(details.providerReferenceFingerprint
                ? {
                    providerReferenceFingerprint: details.providerReferenceFingerprint
                  }
                : {})
            })

      const execute = (input: { readonly intentId: string; readonly now: string }) =>
        Effect.gen(function* () {
          const execution = yield* store.load(input.intentId)
          let intent = yield* lifecycle.findById(input.intentId)
          if (intent.phase === 'terminal' || intent.supersededAt) return
          if (options.destinationConfigured === false) {
            yield* lifecycle.markNotSent({
              intentId: intent.id,
              reason: 'needs_configuration',
              now: input.now
            })
            return
          }
          if (!configured.meta && !configured.smso) {
            yield* lifecycle.markNotSent({
              intentId: intent.id,
              reason: 'needs_configuration',
              now: input.now
            })
            return
          }

          const inFlight = intent.routes
            .flatMap((route) => route.attempts.map((attempt) => ({ route, attempt })))
            .find(
              ({ route, attempt }) =>
                route.state === 'submitting' &&
                !route.submissionOutcomes.some(
                  (outcome) => outcome.attemptId === attempt.id
                )
            )
          if (inFlight) {
            if (
              Date.parse(input.now) - Date.parse(inFlight.attempt.startedAt) <
              staleSubmissionMilliseconds
            )
              return
            yield* durableOutcome(
              intent.id,
              inFlight.attempt.id,
              input.now,
              'submission_unknown',
              inFlight.route.provider,
              { sourceEventKey: `recovery:${inFlight.attempt.id}:stale` }
            )
            return
          }

          const buildEligibility = (channel: 'whatsapp' | 'sms') =>
            eligibilityFor(
              intent,
              execution,
              channel,
              input.now,
              configured[channel === 'whatsapp' ? 'meta' : 'smso']
            )

          if (!intent.reservation) {
            intent = yield* lifecycle.beginRouting({
              intentId: intent.id,
              environment: options.environment,
              eligibility: {
                whatsapp: buildEligibility('whatsapp'),
                sms: buildEligibility('sms')
              },
              now: input.now
            })
            if (intent.phase === 'terminal') return
          }

          for (let routePass = 0; routePass < 2; routePass += 1) {
            intent = yield* lifecycle.findById(intent.id)
            if (intent.phase === 'terminal') return
            const route = intent.routes.find((candidate) => {
              if (candidate.state === 'eligible') return true
              if (candidate.state !== 'submitting') return false
              const last = candidate.attempts.at(-1)
              const outcome = last
                ? candidate.submissionOutcomes.find(
                    (candidateOutcome) => candidateOutcome.attemptId === last.id
                  )
                : undefined
              return (
                outcome?.outcome === 'rejected_retryable' &&
                (!candidate.retryAvailableAt || candidate.retryAvailableAt <= input.now)
              )
            })
            if (!route) return
            const currentEligibility = eligibilityFor(
              intent,
              execution,
              route.channel,
              input.now,
              configured[route.provider]
            )
            const evaluated = yield* Effect.result(
              eligibility.evaluate(currentEligibility)
            )
            if (evaluated._tag === 'Failure') {
              if (route.state === 'eligible')
                yield* lifecycle.recordRouteIneligible({
                  intentId: intent.id,
                  channel: route.channel,
                  reason:
                    evaluated.failure instanceof Error
                      ? evaluated.failure.message
                      : 'route_ineligible',
                  now: input.now
                })
              continue
            }
            const prepared = yield* lifecycle.prepareSubmission({
              intentId: intent.id,
              environment: options.environment,
              channel: route.channel,
              eligibility: currentEligibility,
              requestFingerprint: evaluated.success.template.bodyFingerprint,
              now: input.now
            })
            const revealed = yield* Effect.result(
              options.revealDestination(
                intent.recipientSnapshot.ciphertext,
                intent.recipientSnapshot.keyVersion
              )
            )
            if (revealed._tag === 'Failure') {
              yield* durableOutcome(
                intent.id,
                prepared.attempt.id,
                input.now,
                'rejected_terminal',
                prepared.route.provider,
                { sourceEventKey: `reveal:${prepared.attempt.id}:failed` }
              )
              continue
            }
            const destination = revealed.success
            const providerRequest = {
              attemptId: prepared.attempt.id,
              intentId: intent.id,
              routeId: providerRouteId(prepared.route.id),
              locale: intent.locale,
              purpose: intent.purpose,
              templateVersion: `v${evaluated.success.template.version}`,
              idempotencyKey: providerIdempotencyKey(prepared.attempt.id),
              destination,
              renderedBody: evaluated.success.rendered.body,
              bodyFingerprint: evaluated.success.template.bodyFingerprint
            }
            const response = yield* Effect.result(
              provider.submit(
                prepared.route.provider === 'meta'
                  ? {
                      ...providerRequest,
                      provider: 'meta',
                      channel: 'whatsapp'
                    }
                  : {
                      ...providerRequest,
                      provider: 'smso',
                      channel: 'sms'
                    }
              )
            )
            if (response._tag === 'Failure') {
              yield* durableOutcome(
                intent.id,
                prepared.attempt.id,
                input.now,
                'submission_unknown',
                prepared.route.provider,
                { sourceEventKey: `failure:${prepared.attempt.id}` }
              )
              return
            }
            const outcome = response.success
            switch (outcome._tag) {
              case 'captured':
                yield* durableOutcome(
                  intent.id,
                  prepared.attempt.id,
                  outcome.capturedAt,
                  'captured',
                  prepared.route.provider
                )
                return
              case 'accepted':
                yield* durableOutcome(
                  intent.id,
                  prepared.attempt.id,
                  outcome.acceptedAt,
                  'accepted',
                  prepared.route.provider,
                  {
                    providerReferenceFingerprint: outcome.providerReferenceFingerprint
                  }
                )
                return
              case 'rejected':
                yield* durableOutcome(
                  intent.id,
                  prepared.attempt.id,
                  input.now,
                  outcome.classification === 'terminal'
                    ? 'rejected_terminal'
                    : 'rejected_retryable',
                  prepared.route.provider,
                  { sourceEventKey: `response:${prepared.attempt.id}:${outcome.code}` }
                )
                if (outcome.classification !== 'terminal') return
                break
              case 'throttled':
                yield* durableOutcome(
                  intent.id,
                  prepared.attempt.id,
                  input.now,
                  'rejected_retryable',
                  prepared.route.provider,
                  { sourceEventKey: `response:${prepared.attempt.id}:throttled` }
                )
                return
              case 'ambiguous':
                yield* durableOutcome(
                  intent.id,
                  prepared.attempt.id,
                  outcome.observedAt,
                  'submission_unknown',
                  prepared.route.provider
                )
                return
            }
          }
        })

      return {
        execute,
        discoverDue: ({ now, limit = 100, perShopLimit = 10 }) =>
          store.discoverDue({
            now,
            limit: Math.min(Math.max(limit, 1), 100),
            perShopLimit: Math.min(Math.max(perShopLimit, 1), 10)
          })
      }
    })
  )
