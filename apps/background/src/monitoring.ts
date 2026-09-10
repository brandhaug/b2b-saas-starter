import { layerFromD1 } from '@b2b-saas-starter/db/service'
import {
  LiveOperationalHealth,
  OperationalHealth
} from '@b2b-saas-starter/capabilities/governance/operational-health'
import {
  captureMonitoringSignal,
  captureOperationalSnapshot
} from '@b2b-saas-starter/logger/providers'
import { hasValue } from '@b2b-saas-starter/env/server'
import { Clock, Effect, Layer } from 'effect'
import {
  billingConsumerSettings,
  emailEventsConsumerSettings,
  notificationEmailConsumerSettings,
  type QueueConsumerSettings,
  webhookConsumerSettings,
  workspaceExportConsumerSettings
} from '../../../infra/bindings.ts'
import { type DeliveryOutcome, type Env } from './queue-consumer.ts'

/**
 * Whether this delivery is the platform's last attempt under the given
 * consumer settings. Cloudflare counts `attempts` from 1, so `maxRetries: 3`
 * delivers a message at most four times — the first attempt plus three
 * retries. One predicate for every reader: the export consumer's
 * `finalAttempt` flag, the dead-letter consumers' retry bound, and
 * `exhaustedQueueDelivery` below.
 */
export function finalQueueAttempt(
  attempts: number,
  settings: QueueConsumerSettings
): boolean {
  return attempts >= settings.maxRetries + 1
}

/** Exported policy uses the same retry settings as the deployed consumers. */
export function exhaustedQueueDelivery(
  queue: string,
  attempts: number,
  retrying: boolean
): boolean {
  if (queue.endsWith('-dlq')) {
    return true
  }
  if (!retrying) {
    return false
  }
  // oxlint-disable-next-line effect/noAs -- literal queue suffix/settings pairs
  const policies = [
    ['-billing', billingConsumerSettings],
    ['-email-events', emailEventsConsumerSettings],
    ['-notification-emails', notificationEmailConsumerSettings],
    ['-workspace-exports', workspaceExportConsumerSettings],
    ['-webhooks', webhookConsumerSettings]
  ] as const
  const policy = policies.find(([suffix]) => queue.endsWith(suffix))?.[1]
  return finalQueueAttempt(attempts, policy ?? webhookConsumerSettings)
}

export function monitorQueueOutcome(
  queue: string,
  message: Message<unknown>,
  outcome: DeliveryOutcome
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const evidence = { queue, messageId: message.id, attempts: message.attempts }
    if (exhaustedQueueDelivery(queue, message.attempts, outcome !== 'ack')) {
      yield* Effect.promise(() => captureMonitoringSignal('queue_exhausted', evidence))
    }
    if (queue.endsWith('-email-events') && outcome !== 'ack') {
      yield* Effect.promise(() =>
        captureMonitoringSignal('email_event_processing_failed', evidence)
      )
    }
    const ageMs = (yield* Clock.currentTimeMillis) - message.timestamp.getTime()
    if (ageMs >= 900_000) {
      yield* Effect.promise(() =>
        captureMonitoringSignal('queue_backlog_age', { ...evidence, ageMs })
      )
    }
  })
}

/** Snapshot zeros clear metric incidents after persisted failures recover. */
export function monitorOperationalHealth(env: Env, scheduledTime: number) {
  if (!hasValue(env.SENTRY_DSN) || env.DB === undefined) {
    return Effect.void
  }
  return Effect.gen(function* () {
    const health = yield* OperationalHealth
    const snapshot = yield* health.read(scheduledTime)
    yield* Effect.promise(() =>
      captureOperationalSnapshot({
        'billing.overdue_workspaces': snapshot.overdueBilling,
        'email.recent_transport_failures': snapshot.recentEmailFailures,
        'email.overdue_pending': snapshot.pendingEmail
      })
    )
  }).pipe(
    Effect.provide(LiveOperationalHealth.pipe(Layer.provide(layerFromD1(env.DB))))
  )
}
