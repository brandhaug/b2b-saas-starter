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
  type EmailRenderError,
  type EmailSendError
} from '@b2b-saas-starter/email'
import { notificationEmailFor } from '@b2b-saas-starter/email/notification-emails'
import { withTriggerScope } from '@b2b-saas-starter/logger'
import { Effect, Layer, Schema, type Scope } from 'effect'

import { appUrlFrom, openUrlFor, preferencesUrl } from './notification-links.ts'
import {
  queueDelivery,
  queueParentSpan,
  type DeliveryOutcome,
  type QueueDelivery,
  type QueueEnvelope
} from './queue-consumer.ts'
import { type Env } from './webhook-consumer.ts'

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
 * channel for the kind (skipped unless it is still `instant`). Only a render
 * or send failure retries — a skip is a settled outcome.
 *
 * Requirements stay open so tests inject stub layers; `sendNotificationEmail`
 * wraps this with the real layers and the wide-event scope.
 */
export function processNotificationEmailMessage(
  delivery: QueueDelivery<NotificationEmailMessage>,
  appUrl: string
): Effect.Effect<
  DeliveryOutcome,
  CapabilityUnavailable | EmailRenderError | EmailSendError,
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
    yield* dispatcher.send({
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
    yield* Effect.annotateLogsScoped({ outcome: 'sent' })
    return ack
  })
}

/**
 * Queue consumer entry: the boundary decode, the real capability and email
 * layers, and a `notification_email` wide event per message. A failure is
 * logged on the event and retried by the queue.
 */
export function sendNotificationEmail(
  envelope: QueueEnvelope,
  env: Env
): Effect.Effect<DeliveryOutcome> {
  const delivery = readNotificationEmailDelivery(envelope)
  return withTriggerScope(
    {
      service: 'background',
      event: 'notification_email',
      parent: queueParentSpan(delivery),
      spanKind: 'consumer',
      env,
      metadata: { attempts: delivery.attempts }
    },
    processNotificationEmailMessage(delivery, appUrlFrom(env)).pipe(
      Effect.provide(
        Layer.merge(
          selectCapabilitiesLayer(starterEnv(env)),
          selectEmailDispatcherLayer(env)
        )
      )
    )
    // The wide event already logged the cause; the queue needs an outcome.
  ).pipe(Effect.catchCause((_cause) => Effect.succeed<DeliveryOutcome>('retry')))
}
