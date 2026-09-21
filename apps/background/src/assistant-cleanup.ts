import { AssistantConversationLifecycle } from '@b2b-saas-starter/capabilities/assistant/lifecycle'
import { AssistantAdmission } from '@b2b-saas-starter/capabilities/assistant/admission'
import {
  selectCapabilitiesLayer,
  starterEnv
} from '@b2b-saas-starter/capabilities/runtime'
import { withTriggerScope } from '@b2b-saas-starter/logger'
import { Effect, Metric, Result } from 'effect'
import { type Env } from './queue-consumer.ts'

const cleanupRuns = Metric.counter('starter.assistant.cleanup_runs', {
  description: 'Assistant deletion cleanup passes by outcome.',
  incremental: true
})
const releasedReservations = Metric.counter('starter.assistant.expired_reservations', {
  description: 'Abandoned admission reservations reconciled after their deadline.',
  incremental: true
})

/** Explicit deletion is already authorized. Retention age approval does not gate its retry. */
export function cleanupAssistant(env: Env, scheduledTime: number) {
  if (!env.DB) {
    return Effect.void
  }
  return withTriggerScope(
    {
      service: 'background',
      event: 'assistant_cleanup',
      env,
      metadata: { scheduledTime }
    },
    Effect.gen(function* () {
      const admission = yield* AssistantAdmission
      const expired = yield* admission.reconcileExpired(100)
      yield* Metric.update(releasedReservations, expired)
      yield* Effect.annotateLogsScoped({ expiredReservations: expired })
      const lifecycle = yield* AssistantConversationLifecycle
      const result = yield* lifecycle.cleanup(100).pipe(Effect.result)
      if (Result.isFailure(result)) {
        yield* Metric.update(
          Metric.withAttributes(cleanupRuns, { outcome: 'failed' }),
          1
        )
        yield* Effect.annotateLogsScoped({
          outcome: 'failed',
          reason: 'conversation_cleanup_unavailable'
        })
        return yield* Effect.fail(result.failure)
      }
      yield* Metric.update(
        Metric.withAttributes(cleanupRuns, { outcome: 'completed' }),
        1
      )
      yield* Effect.annotateLogsScoped({
        outcome: 'completed',
        cleanedConversations: result.success
      })
    }).pipe(Effect.provide(selectCapabilitiesLayer(starterEnv(env))))
  )
}
