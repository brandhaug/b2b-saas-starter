import {
  selectCapabilitiesLayer,
  starterEnv
} from '@b2b-saas-starter/capabilities/runtime'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import { NotificationEmailQueueMessage } from '@b2b-saas-starter/capabilities/notifications/notification-email-queue'
import { NotificationFeed } from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import { renderNotificationCopy } from '@b2b-saas-starter/capabilities/notifications/notification-events'
import { NotificationPreferences } from '@b2b-saas-starter/capabilities/notifications/notification-preferences'
import { notificationKindLabel } from '@b2b-saas-starter/capabilities/notifications/notification-kinds'
import * as m from '@b2b-saas-starter/i18n/messages'
import { DEFAULT_LOCALE, type Locale } from '@b2b-saas-starter/i18n/locale'
import {
  type EmailDispatcher,
  selectEmailDispatcherLayer
} from '@b2b-saas-starter/email'
import { notificationEmailFor } from '@b2b-saas-starter/email/notification-emails'
import { dispatchTrackedEmail } from '@b2b-saas-starter/email/tracked'
import { EmailDelivery } from '@b2b-saas-starter/capabilities/email-delivery/email-delivery'
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
  CapabilityUnavailable,
  | NotificationFeed
  | NotificationPreferences
  | EmailDispatcher
  | EmailDelivery
  | Scope.Scope
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
    const messageId = `notification:${notificationId}:${recipientUserId}`
    const history = yield* EmailDelivery
    yield* Effect.annotateLogsScoped({ notificationId, recipientUserId })
    const feed = yield* NotificationFeed
    const context = yield* feed.loadForEmail(notificationId, recipientUserId)
    if (context === null) {
      yield* history.abandon(messageId)
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
      yield* history.abandon(messageId)
      yield* Effect.annotateLogsScoped({
        outcome: 'skipped',
        skipReason: `channel_${channel}`
      })
      return ack
    }
    const locale: Locale = context.recipient.locale ?? DEFAULT_LOCALE
    const kindLabel = notificationKindLabel(kind, locale)
    const copy = renderNotificationCopy(
      context.notification,
      locale,
      context.recipient.timeZone ?? 'UTC'
    )
    const workspaceName = context.workspace?.name ?? null
    yield* dispatchTrackedEmail(
      {
        id: messageId,
        purpose: 'notification',
        recipient: context.recipient.email,
        userId: recipientUserId,
        workspaceId: null,
        referenceId: notificationId,
        queuedAt: context.notification.createdAt
      },
      {
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
      }
    ).pipe(
      // A render failure is a deterministic template bug: redelivery can
      // never fix it and this queue has no DLQ, so an identical retry would
      // burn every attempt and drop the email silently. Terminal like a
      // malformed body — annotate the wide event and ack. A send failure
      // keeps its error channel and rides the queue's backoff.
      Effect.catchTag('EmailRenderError', () =>
        Effect.annotateLogsScoped({
          outcome: 'skipped',
          skipReason: 'render_failed',
          renderError: 'template_failed'
        }).pipe(Effect.as(ack))
      ),
      // The capability persists the sanitized failure; completion below owns
      // whether the queue should retry, including an active-lease skip.
      Effect.catchTag('EmailSendError', () => Effect.succeed(ack))
    )
    const completion = yield* history.completionDecision(messageId)
    if (completion.outcome === 'retry_pending') {
      yield* Effect.annotateLogsScoped({ outcome: completion.outcome })
      return { retryAfterSeconds: completion.retryAfterSeconds }
    }
    yield* Effect.annotateLogsScoped({ outcome: completion.status })
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
  }).pipe(
    Effect.map((outcome) => {
      if (outcome === 'retry') {
        // Store failures have no persisted due time yet. Keep those queue
        // attempts spread far enough apart to cover the full retry window.
        return {
          retryAfterSeconds: Math.min(
            3600,
            60 * 2 ** Math.min(envelope.attempts - 1, 6)
          )
        }
      }
      return outcome
    })
  )
}
