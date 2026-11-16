import { Array as Arr, Effect, Result } from 'effect'
import { annotateWideEvent } from '@b2b-saas-starter/logger'

import { bestEffort } from '../internal/best-effort.ts'
import { withTraceparent } from '../internal/traceparent.ts'
import {
  type NotificationEmailQueueBinding,
  type NotificationEmailQueueMessage
} from './notification-email-queue.ts'
import { type NotificationKind } from './notification-kinds.ts'
import { type Locale } from '@b2b-saas-starter/i18n/locale'
import { type NotificationPreferencesInterface } from './notification-preferences.ts'

export type EmailQueueRecipient = {
  readonly userId: string
  readonly email: string
  readonly name: string
  /** Saved account locale, when the recipient has selected one. */
  readonly locale?: Locale | null | undefined
  readonly timeZone?: string | null | undefined
}

type InstantFanOutInput = {
  readonly notificationId: string
  readonly kind: NotificationKind
  readonly recipients: ReadonlyArray<EmailQueueRecipient>
  readonly traceparent: string | undefined
}

/**
 * Cloudflare Queues `sendBatch` accepts at most 100 messages and 256 KB. A
 * message carries ids and a traceparent (well under 1 KB), so the count is
 * the binding limit.
 */
const QUEUE_BATCH_LIMIT = 100

/**
 * The instant half of a Notification's email fan-out, shared by both feed
 * adapters: resolve the recipients' channel for the kind and enqueue one
 * message per `instant` recipient, one preference read and one `sendBatch`
 * per batch of at most {@link QUEUE_BATCH_LIMIT} recipients.
 *
 * Provider-light and best-effort, like `publishWebhookEventWith`: no binding
 * means nothing is enqueued, and a failed batch annotates the wide event
 * instead of failing the producer — the Notification row is already the
 * durable record, and the digest still covers a recipient whose instant
 * email was lost. One failed batch does not drop the others.
 */
export const enqueueInstantEmails = Effect.fn('NotificationFeed.enqueueInstantEmails')(
  function* (
    queue: NotificationEmailQueueBinding | undefined,
    preferences: NotificationPreferencesInterface,
    input: InstantFanOutInput
  ): Effect.fn.Return<void> {
    if (queue === undefined || input.recipients.length === 0) {
      return
    }
    const outcomes = yield* Effect.forEach(
      Arr.chunksOf(input.recipients, QUEUE_BATCH_LIMIT),
      (batch) => enqueueBatch(queue, preferences, input, batch),
      { concurrency: 4 }
    )
    let enqueued = 0
    let failedRecipients = 0
    for (const outcome of outcomes) {
      enqueued += outcome.enqueued
      failedRecipients += outcome.failed
    }
    // Totals, written once: concurrent batches would overwrite each other's
    // count on the one wide event.
    if (failedRecipients > 0) {
      yield* annotateWideEvent({ notificationEmailRecipients: failedRecipients })
    }
    if (enqueued > 0) {
      yield* annotateWideEvent({ notificationEmailEnqueued: enqueued })
    }
  }
)

type EnqueueFailureReason = 'preferences_unavailable' | 'queue_rejected'

function enqueueFailure(reason: EnqueueFailureReason) {
  return { notificationEmailEnqueue: 'failed', notificationEmailEnqueueReason: reason }
}

/**
 * One batch, reported as counts. An unreadable preference store counts the
 * whole batch as failed (any of them may have been instant); a rejected
 * `sendBatch` counts its messages. The digest re-reads both on its own schedule.
 */
// oxlint-disable-next-line starter/named-effect-operation -- one call per 100-recipient batch inside the traced NotificationFeed.enqueueInstantEmails operation
const enqueueBatch = Effect.fnUntraced(function* (
  queue: NotificationEmailQueueBinding,
  preferences: NotificationPreferencesInterface,
  input: InstantFanOutInput,
  batch: ReadonlyArray<EmailQueueRecipient>
) {
  const channels = yield* bestEffort(
    preferences.resolveForUsers(
      batch.map((recipient) => recipient.userId),
      input.kind
    ),
    () => enqueueFailure('preferences_unavailable')
  )
  if (Result.isFailure(channels)) {
    return { enqueued: 0, failed: batch.length }
  }
  const messages = batch.flatMap((recipient) => {
    if (channels.success.get(recipient.userId) !== 'instant') {
      return []
    }
    const message = {
      body: withTraceparent(
        { notificationId: input.notificationId, recipientUserId: recipient.userId },
        input.traceparent
      )
    } satisfies { readonly body: NotificationEmailQueueMessage }
    return [message]
  })
  if (messages.length === 0) {
    return { enqueued: 0, failed: 0 }
  }
  // The rejection's message is provider text; only the code-owned reason
  // reaches the wide event.
  const sent = yield* bestEffort(
    Effect.tryPromise({
      try: () => queue.sendBatch(messages),
      catch: (): EnqueueFailureReason => 'queue_rejected'
    }),
    enqueueFailure
  )
  if (Result.isFailure(sent)) {
    return { enqueued: 0, failed: messages.length }
  }
  return { enqueued: messages.length, failed: 0 }
})
