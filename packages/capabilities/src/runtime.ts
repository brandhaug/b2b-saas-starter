import { layerFromD1 } from '@b2b-saas-starter/db/service'
import { Layer } from 'effect'
import { type LiveBillingOptions } from './billing/billing.ts'
import { type WebhookQueueBinding } from './developer-platform/webhook-publisher.ts'
import { type WorkspaceInvitationBinding } from './governance/workspace-invitations.ts'
import { type WorkspaceLifecycleBinding } from './governance/workspace-lifecycle.ts'
import { type WorkspaceMemberBinding } from './governance/workspace-membership.ts'
import { type PlatformUserAdminBinding } from './governance/platform-user-admin.ts'
import {
  type WorkspaceExportBucketBinding,
  type WorkspaceExportQueueBinding
} from './governance/workspace-export.ts'
import {
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

export type StarterEnv = {
  readonly DB?: D1Binding | undefined
  readonly WEBHOOK_QUEUE?: WebhookQueueBinding | undefined
  /** Export job queue (ADR 0054). Absent with `WORKSPACE_EXPORT_BUCKET`, exports report unavailable. */
  readonly WORKSPACE_EXPORT_QUEUE?: WorkspaceExportQueueBinding | undefined
  /** Export artifact bucket (ADR 0054). Absent, exports report unavailable. */
  readonly WORKSPACE_EXPORT_BUCKET?: WorkspaceExportBucketBinding | undefined
  /**
   * Adapter onto the organization plugin's member endpoints, supplied by the
   * app because two of the three endpoints need the request's session headers
   * and only the app holds them. Not a worker binding like the fields above —
   * it rides here so one `StarterEnv` still selects the whole layer.
   *
   * Absent, membership reads work and mutations fail `CapabilityUnavailable`.
   */
  readonly memberBinding?: WorkspaceMemberBinding | undefined
  /**
   * Adapter onto the organization plugin's invitation endpoints. Every one of
   * them is `requireHeaders: true`, so unlike `memberBinding` there is no
   * headerless half — the app must supply this or invitations stay read-only.
   *
   * Absent, invitation reads work and mutations fail `CapabilityUnavailable`.
   */
  readonly invitationBinding?: WorkspaceInvitationBinding | undefined
  /**
   * Adapter onto the organization plugin's workspace lifecycle endpoints.
   * Absent, lifecycle mutations fail `CapabilityUnavailable`.
   */
  readonly lifecycleBinding?: WorkspaceLifecycleBinding | undefined
  /**
   * Adapter onto the admin plugin's user endpoints plus one organization-plugin
   * member call. Absent, `/admin` reads work and its mutations fail
   * `CapabilityUnavailable`.
   */
  readonly userAdminBinding?: PlatformUserAdminBinding | undefined
  /**
   * Stripe checkout configuration, forwarded to the Live billing layer.
   * Absent (env unset), checkout fails `provider_not_configured` and the rest
   * of the app is unaffected — provider-light degradation.
   */
  readonly billing?: LiveBillingOptions | undefined
}

/**
 * The worker-bindings projection: the `{ DB, WEBHOOK_QUEUE }` subset of a
 * worker's env that selects the capability layer (Live vs Seed, fan-out on or
 * off). Canonical home is here beside `StarterEnv`; workers project their own
 * env type through it so the field set cannot drift between apps.
 */
export function starterEnv(
  env: Pick<
    StarterEnv,
    'DB' | 'WEBHOOK_QUEUE' | 'WORKSPACE_EXPORT_QUEUE' | 'WORKSPACE_EXPORT_BUCKET'
  >
): StarterEnv {
  return {
    DB: env.DB,
    WEBHOOK_QUEUE: env.WEBHOOK_QUEUE,
    WORKSPACE_EXPORT_QUEUE: env.WORKSPACE_EXPORT_QUEUE,
    WORKSPACE_EXPORT_BUCKET: env.WORKSPACE_EXPORT_BUCKET
  }
}

/**
 * The env fields `makeLiveCapabilitiesLayer` consumes, projected once so both
 * selectors forward the same set and none can drift out of one of them.
 */
function liveCapabilitiesOptions(env: StarterEnv) {
  return {
    webhookQueue: env.WEBHOOK_QUEUE,
    memberBinding: env.memberBinding,
    invitationBinding: env.invitationBinding,
    lifecycleBinding: env.lifecycleBinding,
    userAdminBinding: env.userAdminBinding,
    billing: env.billing,
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
