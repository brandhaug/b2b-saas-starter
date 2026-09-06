import {
  selectCapabilitiesLayer,
  starterEnv
} from '@b2b-saas-starter/capabilities/runtime'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import { NotificationEmailQueueMessage } from '@b2b-saas-starter/capabilities/notifications/notification-email-queue'
import { NotificationFeed } from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import { renderNotificationEvent } from '@b2b-saas-starter/capabilities/notifications/notification-events'
import { NotificationPreferences } from '@b2b-saas-starter/capabilities/notifications/notification-preferences'
import * as m from '@b2b-saas-starter/i18n/messages'
import { DEFAULT_LOCALE, type Locale } from '@b2b-saas-starter/i18n/locale'
import {
  EmailDispatcher,
  selectEmailDispatcherLayer,
  type EmailSendError
} from '@b2b-saas-starter/email'
import { notificationEmailFor } from '@b2b-saas-starter/email/notification-emails'
import { Effect, Layer, type Scope } from 'effect'

import { appUrlFrom, openUrlFor, preferencesUrl } from './notification-links.ts'
import {
  consumerInvocation,
  type DeliveryOutcome,
  type Env,
  readDelivery,
  type QueueDelivery,
  type QueueEnvelope
} from './queue-consumer.ts'

const ack: DeliveryOutcome = 'ack'

function localizedKindLabel(kind: string, locale: Locale): string {
  const options = { locale }
  switch (kind) {
    case 'api_token.created': {
      return m.backend_email_notification_kind_api_token_created({}, options)
    }
    case 'api_token.revoked': {
      return m.backend_email_notification_kind_api_token_revoked({}, options)
    }
    case 'workspace_member.role_changed': {
      return m.backend_email_notification_kind_role_changed({}, options)
    }
    case 'two_factor.changed': {
      return m.backend_email_notification_kind_two_factor_changed({}, options)
    }
    case 'webhook.delivery_failed': {
      return m.backend_email_notification_kind_webhook_failed({}, options)
    }
    case 'workspace_member.joined': {
      return m.backend_email_notification_kind_member_joined({}, options)
    }
    case 'billing.plan_changed': {
      return m.backend_email_notification_kind_plan_changed({}, options)
    }
    case 'account.impersonated': {
      return m.backend_email_notification_kind_impersonated({}, options)
    }
    default: {
      return m.backend_email_notification_kind_announcement({}, options)
    }
  }
}

function notificationCopy(
  notification: {
    readonly title: string
    readonly message: string
    readonly event?: Parameters<typeof renderNotificationEvent>[0] | undefined
  },
  locale: Locale,
  timeZone = 'UTC'
) {
  if (notification.event === undefined) {
    return { title: notification.title, message: notification.message }
  }
  return renderNotificationEvent(notification.event, locale, timeZone)
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
  delivery: QueueDelivery<NotificationEmailQueueMessage>,
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
    const locale: Locale = context.recipient.locale ?? DEFAULT_LOCALE
    const kindLabel = localizedKindLabel(kind, locale)
    const copy = notificationCopy(
      context.notification,
      locale,
      context.recipient.timeZone ?? 'UTC'
    )
    const workspaceName = context.workspace?.name ?? null
    yield* dispatcher
      .send({
        to: context.recipient.email,
        subject: m.backend_email_subject_notification(
          { kindLabel, title: copy.title },
          { locale }
        ),
        element: notificationEmailFor(kind, {
          kindLabel,
          title: copy.title,
          message: copy.message,
          workspaceName,
          openUrl: openUrlFor(appUrl, context),
          preferencesUrl: preferencesUrl(appUrl, kind),
          locale
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
  const delivery = readDelivery(NotificationEmailQueueMessage, envelope)
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
