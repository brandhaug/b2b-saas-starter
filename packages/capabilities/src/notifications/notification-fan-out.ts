import { Effect, Result } from 'effect'

import {
  type NotificationEmailQueueBinding,
  type NotificationEmailQueueMessage
} from './notification-email-queue.ts'
import { type NotificationKind } from './notification-kinds.ts'
import { type NotificationPreferencesInterface } from './notification-preferences.ts'

export type EmailQueueRecipient = {
  readonly userId: string
  readonly email: string
  readonly name: string
}

export type InstantFanOutInput = {
  readonly notificationId: string
  readonly kind: NotificationKind
  readonly recipients: ReadonlyArray<EmailQueueRecipient>
  readonly traceparent: string | undefined
}

function withTraceparent(
  message: NotificationEmailQueueMessage,
  traceparent: string | undefined
): NotificationEmailQueueMessage {
  if (traceparent === undefined) {
    return message
  }
  return { ...message, traceparent }
}

/**
 * The instant half of a Notification's email fan-out, shared by both feed
 * adapters: resolve each recipient's channel for the kind and enqueue one
 * message per `instant` recipient.
 *
 * Provider-light and best-effort, like `publishWebhookEventWith`: no binding
 * means nothing is enqueued, and a queue rejection annotates the wide event
 * instead of failing the producer — the Notification row is already the
 * durable record, and the digest still covers a recipient whose instant
 * email was lost.
 */
export function enqueueInstantEmails(
  queue: NotificationEmailQueueBinding | undefined,
  preferences: NotificationPreferencesInterface,
  input: InstantFanOutInput
): Effect.Effect<void> {
  return Effect.gen(function* () {
    if (queue === undefined || input.recipients.length === 0) {
      return
    }
    const messages: Array<{ readonly body: NotificationEmailQueueMessage }> = []
    for (const recipient of input.recipients) {
      const channel = yield* Effect.result(
        preferences.resolve(recipient.userId, input.kind)
      )
      // An unreadable preference store means no instant email for this
      // recipient — the digest job re-reads preferences on its own schedule.
      if (Result.isSuccess(channel) && channel.success === 'instant') {
        messages.push({
          body: withTraceparent(
            { notificationId: input.notificationId, recipientUserId: recipient.userId },
            input.traceparent
          )
        })
      }
    }
    if (messages.length === 0) {
      return
    }
    const sent = yield* Effect.result(
      Effect.tryPromise({
        try: () => queue.sendBatch(messages),
        catch: (cause) => cause
      })
    )
    if (Result.isFailure(sent)) {
      yield* Effect.void.pipe(
        Effect.annotateLogs({
          notificationEmailEnqueue: 'failed',
          notificationEmailRecipients: messages.length
        })
      )
      return
    }
    yield* Effect.void.pipe(
      Effect.annotateLogs({ notificationEmailEnqueued: messages.length })
    )
  })
}
