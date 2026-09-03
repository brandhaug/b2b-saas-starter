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
import { parentSpanFromHeaders, withTriggerScope } from '@b2b-saas-starter/logger'
import { Effect, Layer, Result, Schema, type Scope } from 'effect'

import { appUrlFrom, openUrlFor, preferencesUrl } from './notification-links.ts'
import {
  type DeliveryOutcome,
  type Env,
  type WebhookQueueEnvelope
} from './webhook-consumer.ts'

const ack: DeliveryOutcome = 'ack'

/** Wire shape of the instant-email queue — the schema is shared with the producer. */
export type NotificationEmailMessage = typeof NotificationEmailQueueMessage.Type

const decodeMessage = Schema.decodeUnknownResult(NotificationEmailQueueMessage)

/**
 * One queue message after the boundary decode, on the same footing as
 * `WebhookQueueDelivery`: a malformed body is terminal (redelivery cannot fix
 * its shape) and is acked with the reason on the wide event.
 */
export type NotificationEmailDelivery = {
  readonly id?: string | undefined
  readonly attempts: number
} & (
  | { readonly kind: 'message'; readonly message: NotificationEmailMessage }
  | { readonly kind: 'malformed' }
)

export function readNotificationEmailDelivery(
  envelope: WebhookQueueEnvelope
): NotificationEmailDelivery {
  const decoded = decodeMessage(envelope.body)
  const platform = { id: envelope.id, attempts: envelope.attempts }
  if (Result.isFailure(decoded)) {
    return { ...platform, kind: 'malformed' }
  }
  return { ...platform, kind: 'message', message: decoded.success }
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
  delivery: NotificationEmailDelivery,
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
    const workspaceName = context.workspace?.name ?? null
    yield* dispatcher.send({
      // The dispatcher's `defaultFrom` (CLOUDFLARE_EMAIL_FROM) fills this in.
      from: '',
      to: context.recipient.email,
      subject: `[B2B SaaS Starter] ${describeNotificationKind(kind).label}: ${context.notification.title}`,
      element: notificationEmailFor(kind, {
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

function queueParentSpan(delivery: NotificationEmailDelivery) {
  if (delivery.kind === 'message') {
    return parentSpanFromHeaders({ traceparent: delivery.message.traceparent })
  }
  return parentSpanFromHeaders({})
}

/**
 * Queue consumer entry: the boundary decode, the real capability and email
 * layers, and a `notification_email` wide event per message. A failure is
 * logged on the event and retried by the queue.
 */
export function sendNotificationEmail(
  envelope: WebhookQueueEnvelope,
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
