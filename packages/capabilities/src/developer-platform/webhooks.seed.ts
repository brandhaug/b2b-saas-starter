import { type Billing } from '@b2b-saas-starter/billing/billing'
import { type ResourceEntitlements } from '@b2b-saas-starter/billing/resource-entitlements'
import { Layer } from 'effect'
import { type AuditEventLog } from '../governance/audit-event-log.ts'
import { type Workspace } from '../governance/workspace-identity.ts'
import { type NotificationFeed } from '../notifications/notification-feed.ts'
import { type WebhookDeliveries } from './webhook-deliveries.ts'
import { SeedWebhookDeliveries } from './webhook-deliveries.seed.ts'
import { type WebhookDeliveryAdmin } from './webhook-delivery-admin.ts'
import { SeedWebhookDeliveryAdmin } from './webhook-delivery-admin.seed.ts'
import { type WebhookDeliveryAttempt } from './webhook-delivery-plan.ts'
import { type WebhookDispatch } from './webhook-dispatch.ts'
import { SeedWebhookDispatch } from './webhook-dispatch.seed.ts'
import { type WebhookEndpoints } from './webhook-endpoints.ts'
import { SeedWebhookEndpoints } from './webhook-endpoints.seed.ts'
import { type WebhookPublisher } from './webhook-publisher.ts'
import {
  type SeedDeliveryFixture,
  type SeedWebhookEndpointFixture,
  SeedWebhookStoreLayer
} from './webhook-store.seed.ts'

export type SeedWebhookServices =
  | WebhookEndpoints
  | WebhookDeliveries
  | WebhookDeliveryAdmin
  | WebhookDispatch

/**
 * The four Seed webhook services over one fixture store, so a write through
 * one is what the others read. Each call builds a fresh store.
 */
export function SeedWebhooks(
  seedFixtures: ReadonlyArray<SeedWebhookEndpointFixture>,
  seedDeliveries: ReadonlyArray<SeedDeliveryFixture> = [],
  seedWorkspaces?: ReadonlyArray<Workspace>,
  seedAttempts: ReadonlyArray<WebhookDeliveryAttempt> = []
): Layer.Layer<
  SeedWebhookServices,
  never,
  Billing | AuditEventLog | WebhookPublisher | NotificationFeed | ResourceEntitlements
> {
  // The adapters are module constants, and a Layer build memoizes by
  // reference: without `fresh`, a second `SeedWebhooks` in the same build would
  // reuse the first one's adapters and so read the first one's store.
  return Layer.mergeAll(
    Layer.fresh(SeedWebhookEndpoints),
    Layer.fresh(SeedWebhookDeliveries),
    Layer.fresh(SeedWebhookDeliveryAdmin),
    Layer.fresh(SeedWebhookDispatch)
  ).pipe(
    Layer.provide(
      SeedWebhookStoreLayer(seedFixtures, seedDeliveries, seedWorkspaces, seedAttempts)
    )
  )
}
