import { type Effect } from 'effect'
import { type HttpClient } from 'effect/unstable/http'

import { buildWorkspaceExport } from './export-consumer.ts'
import { sendNotificationEmail } from './notification-email-consumer.ts'
import { consumeEmailEvent } from './email-events-consumer.ts'
import { deliverSeatSync } from './seat-sync-consumer.ts'
import { recoverBillingDeadLetter } from './billing-dead-letter-consumer.ts'
import { deliverWebhook, recordDeadLetter } from './webhook-consumer.ts'
import { type DeliveryOutcome, type Env, type QueueEnvelope } from './queue-consumer.ts'

/** One queue's consumer entry, as the batch loop calls it. */
type QueueConsumer = (
  envelope: QueueEnvelope,
  env: Env
) => Effect.Effect<DeliveryOutcome, never, HttpClient.HttpClient>

/**
 * Queue suffix → consumer entry. Physical queue names are `stageResourceNames`
 * (`infra/bindings.ts`) and every non-production stage prefixes them, so a
 * preview's exports arrive on `b2b-saas-starter-pr-42-workspace-exports` while
 * production's arrive on `b2b-saas-starter-workspace-exports`. The stage is not
 * in the worker's env, so the branch keys off the suffix both forms share — the
 * same way `exhaustedQueueDelivery` reads its retry policy. Dead letters come
 * first: `-webhooks-dlq` must not match as `-webhooks`.
 */
const queueConsumers: ReadonlyArray<readonly [string, QueueConsumer]> = [
  ['-webhooks-dlq', recordDeadLetter],
  ['-billing-dlq', recoverBillingDeadLetter],
  ['-webhooks', deliverWebhook],
  ['-billing', deliverSeatSync],
  // Workspace export jobs (ADR 0055): build the archive into R2.
  ['-workspace-exports', buildWorkspaceExport],
  ['-notification-emails', sendNotificationEmail],
  ['-email-events', consumeEmailEvent]
]

/**
 * The consumer bound to this queue, or `undefined` for a name no branch above
 * claims — a queue this worker is not bound to consume.
 */
export function queueConsumerFor(queue: string): QueueConsumer | undefined {
  return queueConsumers.find(([suffix]) => queue.endsWith(suffix))?.[1]
}
