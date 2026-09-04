import { layerFromD1 } from '@b2b-saas-starter/db/service'
import { Layer } from 'effect'
import { type SeatSyncQueueBinding } from './billing/seat-sync.ts'
import { type WebhookQueueBinding } from './developer-platform/webhook-publisher.ts'
import { type NotificationEmailQueueBinding } from './notifications/notification-email-queue.ts'
import {
  type WorkspaceExportBucketBinding,
  type WorkspaceExportQueueBinding
} from './governance/workspace-export.ts'
import {
  type CapabilityBindings,
  type LiveCapabilitiesOptions,
  makeLiveCapabilitiesLayer,
  makeLiveLayerFromD1,
  SeedLayer,
  type CapabilitiesLayer,
  type CapabilityServices
} from './layers.ts'
import { seedMembers, seedWorkspaceRecord } from './seed-fixture.ts'
import {
  liveWorkspaceContext,
  seedWorkspaceContext,
  type WorkspaceContext,
  type ActorRef
} from './workspace-context.ts'
import { type CapabilityUnavailable, type WorkspaceNotFound } from './errors.ts'

type D1Binding = Parameters<typeof layerFromD1>[0]

/**
 * A worker's env, as the selectors read it. The worker-binding fields keep
 * the env-var names the runtime hands over; the plugin-backed write adapters
 * and per-provider option bags are the shared {@link CapabilityBindings}
 * record, so a new optional binding is declared once there instead of once
 * per consumer of these options.
 */
export type StarterEnv = {
  readonly DB?: D1Binding | undefined
  readonly WEBHOOK_QUEUE?: WebhookQueueBinding | undefined
  /** Export job queue (ADR 0055). Absent with `WORKSPACE_EXPORT_BUCKET`, exports report unavailable. */
  readonly WORKSPACE_EXPORT_QUEUE?: WorkspaceExportQueueBinding | undefined
  /** Export artifact bucket (ADR 0055). Absent, exports report unavailable. */
  readonly WORKSPACE_EXPORT_BUCKET?: WorkspaceExportBucketBinding | undefined
  /** The instant notification-email producer binding; absent means no instant emails. */
  readonly NOTIFICATION_EMAIL_QUEUE?: NotificationEmailQueueBinding | undefined
  /**
   * The seat-sync queue the membership and invitation mutations enqueue onto;
   * the background worker consumes it. Absent (local dev, no queue binding),
   * those mutations publish nothing — seat sync heals on the next mutation.
   */
  readonly BILLING_QUEUE?: SeatSyncQueueBinding | undefined
} & CapabilityBindings

/**
 * The worker-bindings projection: the `{ DB, WEBHOOK_QUEUE }` subset of a
 * worker's env that selects the capability layer (Live vs Seed, fan-out on or
 * off). Canonical home is here beside `StarterEnv`; workers project their own
 * env type through it so the field set cannot drift between apps.
 */
export function starterEnv(
  env: Pick<
    StarterEnv,
    | 'DB'
    | 'WEBHOOK_QUEUE'
    | 'BILLING_QUEUE'
    | 'WORKSPACE_EXPORT_QUEUE'
    | 'WORKSPACE_EXPORT_BUCKET'
    | 'NOTIFICATION_EMAIL_QUEUE'
  >
): StarterEnv {
  return {
    DB: env.DB,
    WEBHOOK_QUEUE: env.WEBHOOK_QUEUE,
    BILLING_QUEUE: env.BILLING_QUEUE,
    WORKSPACE_EXPORT_QUEUE: env.WORKSPACE_EXPORT_QUEUE,
    WORKSPACE_EXPORT_BUCKET: env.WORKSPACE_EXPORT_BUCKET,
    NOTIFICATION_EMAIL_QUEUE: env.NOTIFICATION_EMAIL_QUEUE
  }
}

/**
 * The env fields `makeLiveCapabilitiesLayer` consumes, projected once so both
 * selectors forward the same set and none can drift out of one of them.
 *
 * The plugin bindings and option bags ride on `StarterEnv` under their option
 * names (they are the shared `CapabilityBindings`), so they flow through the
 * spread untouched. Only the ports whose worker env names differ have a line
 * here — that mapping is the env-name seam, not a second field list.
 */
function liveCapabilitiesOptions(env: StarterEnv): LiveCapabilitiesOptions {
  const bindings: CapabilityBindings = env
  return {
    ...bindings,
    webhookQueue: env.WEBHOOK_QUEUE,
    seatSyncQueue: env.BILLING_QUEUE,
    notificationEmailQueue: env.NOTIFICATION_EMAIL_QUEUE,
    workspaceExports: {
      queue: env.WORKSPACE_EXPORT_QUEUE,
      bucket: env.WORKSPACE_EXPORT_BUCKET
    }
  }
}

export function selectCapabilitiesLayer(env: StarterEnv): CapabilitiesLayer {
  if (env.DB === undefined) {
    return SeedLayer
  }
  return makeLiveLayerFromD1(env.DB, liveCapabilitiesOptions(env))
}

/**
 * The per-request half of {@link selectWorkspaceLayer}: only `WorkspaceContext`,
 * the one service that genuinely depends on the request (its workspace slug and
 * actor). Every other capability service is request-independent and belongs at
 * the isolate level via {@link selectCapabilitiesLayer} — rebuilding the whole
 * capability graph per request only to resolve a slug is waste.
 *
 * The Live variant needs nothing but `Database`, which it provides from the D1
 * binding: an isolate-level `Database` cannot be typed here, because the Seed
 * variant runs with no D1 binding at all and there is no honest `Database` to
 * stand in for it.
 */
export function selectWorkspaceContextLayer(
  env: StarterEnv,
  slug: string,
  actor?: ActorRef
): Layer.Layer<WorkspaceContext, WorkspaceNotFound | CapabilityUnavailable> {
  if (env.DB === undefined) {
    // Passing `seedMembers` makes the seed path enforce the same actor
    // membership semantics as the live path (fixture members allowed).
    return seedWorkspaceContext(seedWorkspaceRecord, slug, actor, seedMembers)
  }
  return liveWorkspaceContext(slug, actor).pipe(Layer.provide(layerFromD1(env.DB)))
}

/**
 * Capability services *and* `WorkspaceContext` in one layer, for callers that
 * hold no isolate-level capability layer to ride on — the seed script and the
 * web app's per-request runtime. A worker that already provides capabilities
 * once per isolate wants {@link selectWorkspaceContextLayer} instead.
 */
export function selectWorkspaceLayer(
  env: StarterEnv,
  slug: string,
  actor?: ActorRef
): Layer.Layer<
  CapabilityServices | WorkspaceContext,
  WorkspaceNotFound | CapabilityUnavailable
> {
  if (env.DB === undefined) {
    // Passing `seedMembers` makes the seed path enforce the same actor
    // membership semantics as the live path (fixture members allowed).
    return Layer.merge(
      SeedLayer,
      seedWorkspaceContext(seedWorkspaceRecord, slug, actor, seedMembers)
    )
  }
  return Layer.mergeAll(
    makeLiveCapabilitiesLayer(liveCapabilitiesOptions(env)),
    liveWorkspaceContext(slug, actor)
  ).pipe(Layer.provide(layerFromD1(env.DB)))
}
