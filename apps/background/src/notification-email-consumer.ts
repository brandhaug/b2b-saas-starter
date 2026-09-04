import {
  selectCapabilitiesLayer,
  starterEnv
} from '@b2b-saas-starter/capabilities/runtime'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import { NotificationEmailQueueMessage } from '@b2b-saas-starter/capabilities/notifications/notification-email-queue'
import { NotificationFeed } from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import { describeNotificationKind } from '@b2b-saas-starter/capabilities/notifications/notification-kinds'
import { NotificationPreferences } from '@b2b-saas-starter/capabilities/notifications/notification-preferences'
import {
  EmailDispatcher,
  selectEmailDispatcherLayer,
  type EmailSendError
} from '@b2b-saas-starter/email'
import { notificationEmailFor } from '@b2b-saas-starter/email/notification-emails'
import { Effect, Layer, Schema, type Scope } from 'effect'

import { appUrlFrom, openUrlFor, preferencesUrl } from './notification-links.ts'
import {
  consumerInvocation,
  type DeliveryOutcome,
  type Env,
  queueDelivery,
  type QueueDelivery,
  type QueueEnvelope
} from './queue-consumer.ts'

const ack: DeliveryOutcome = 'ack'

/** Wire shape of the instant-email queue — the schema is shared with the producer. */
export type NotificationEmailMessage = typeof NotificationEmailQueueMessage.Type

const decodeMessage = Schema.decodeUnknownResult(NotificationEmailQueueMessage)

/** The boundary decode: platform fields plus the message, or terminal `malformed`. */
export function readNotificationEmailDelivery(
  envelope: QueueEnvelope
): QueueDelivery<NotificationEmailMessage> {
  return queueDelivery(envelope, decodeMessage(envelope.body))
}

/**
 * Sends one instant notification email. Re-reads everything at send time: the
 * Notification (skipped when it was read or deleted since enqueue), the
 * recipient (skipped when they can no longer see it), and the recipient's
 * channel for the kind (skipped unless it is still `instant`). A send failure
 * retries; a render failure is terminal (see the catch below) and a skip is a
 * settled outcome.
 *
 * Requirements stay open so tests inject stub layers; `sendNotificationEmail`
 * wraps this with the real layers and the wide-event scope.
 */
export function processNotificationEmailMessage(
  delivery: QueueDelivery<NotificationEmailMessage>,
  appUrl: string
): Effect.Effect<
  DeliveryOutcome,
  CapabilityUnavailable | EmailSendError,
  NotificationFeed | NotificationPreferences | EmailDispatcher | Scope.Scope
> {
  return Effect.gen(function* () {
    if (delivery.kind === 'malformed') {
      yield* Effect.annotateLogsScoped({
        outcome: 'skipped',
        skipReason: 'malformed_message'
      })
      return ack
    }
    const { notificationId, recipientUserId } = delivery.message
    yield* Effect.annotateLogsScoped({ notificationId, recipientUserId })
    const feed = yield* NotificationFeed
    const context = yield* feed.loadForEmail(notificationId, recipientUserId)
    if (context === null) {
      yield* Effect.annotateLogsScoped({
        outcome: 'skipped',
        skipReason: 'not_deliverable'
      })
      return ack
    }
    const kind = context.notification.kind
    yield* Effect.annotateLogsScoped({ kind })
    const preferences = yield* NotificationPreferences
    const channel = yield* preferences.resolve(recipientUserId, kind)
    if (channel !== 'instant') {
      yield* Effect.annotateLogsScoped({
        outcome: 'skipped',
        skipReason: `channel_${channel}`
      })
      return ack
    }
    const dispatcher = yield* EmailDispatcher
    const kindLabel = describeNotificationKind(kind).label
    const workspaceName = context.workspace?.name ?? null
    yield* dispatcher
      .send({
        to: context.recipient.email,
        subject: `[B2B SaaS Starter] ${kindLabel}: ${context.notification.title}`,
        element: notificationEmailFor(kind, {
          kindLabel,
          title: context.notification.title,
          message: context.notification.message,
          workspaceName,
          openUrl: openUrlFor(appUrl, context),
          preferencesUrl: preferencesUrl(appUrl, kind)
        })
      })
      .pipe(
        // A render failure is a deterministic template bug: redelivery can
        // never fix it and this queue has no DLQ, so an identical retry would
        // burn every attempt and drop the email silently. Terminal like a
        // malformed body — annotate the wide event and ack. A send failure
        // keeps its error channel and rides the queue's backoff.
        Effect.catchTag('EmailRenderError', (error) =>
          Effect.annotateLogsScoped({
            outcome: 'skipped',
            skipReason: 'render_failed',
            renderError: error.message
          }).pipe(Effect.as(ack))
        )
      )
    yield* Effect.annotateLogsScoped({ outcome: 'sent' })
    return ack
  })
}

/**
 * Queue consumer entry: the boundary decode, the real capability and email
 * layers, and a `notification_email` wide event per message. A failure is
 * logged on the event and retried by the queue; render failures went terminal
 * inside `processNotificationEmailMessage`.
 */
export function sendNotificationEmail(
  envelope: QueueEnvelope,
  env: Env
): Effect.Effect<DeliveryOutcome> {
  const delivery = readNotificationEmailDelivery(envelope)
  return consumerInvocation(env, {
    event: 'notification_email',
    delivery,
    onFailure: 'retry',
    program: processNotificationEmailMessage(delivery, appUrlFrom(env)).pipe(
      Effect.provide(
        Layer.merge(
          selectCapabilitiesLayer(starterEnv(env)),
          selectEmailDispatcherLayer(env)
        )
      )
    )
  })
}
