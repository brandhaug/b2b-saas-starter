import {
  AuditEventLog as BillingAuditEventLog,
  NotificationFeed as BillingNotificationFeed,
  BillingWebhookPublisher as BillingWebhookPublisherPort
} from '@b2b-saas-starter/billing/ports'
import { Effect, Layer } from 'effect'
import { AuditEventLog } from './governance/audit-event-log.ts'
import { NotificationFeed } from './notifications/notification-feed.ts'
import {
  publishWebhookEventForWorkspaceWith,
  WebhookPublisher
} from './developer-platform/webhook-publisher.ts'

/** Preserve the shared audit store and its atomic statement preparation. */
export const BillingAuditLayer = Layer.effect(
  BillingAuditEventLog,
  Effect.map(AuditEventLog, (audit) => ({
    record: audit.record,
    prepareRecord: audit.prepareRecord
  }))
)

/** Billing notices use the same feed and delivery preferences as other producers. */
export const BillingNotificationLayer = Layer.effect(
  BillingNotificationFeed,
  Effect.map(NotificationFeed, (feed) => ({ create: feed.create }))
)

export const BillingWebhookLayer = Layer.effect(
  BillingWebhookPublisherPort,
  Effect.gen(function* () {
    const publisher = yield* WebhookPublisher
    return BillingWebhookPublisherPort.of({
      publishPlanChanged: (input) =>
        publishWebhookEventForWorkspaceWith(publisher, input.workspaceId, {
          eventType: 'billing.plan_changed',
          payload: {
            planId: input.planId,
            previousPlanId: input.previousPlanId
          }
        })
    })
  })
)
