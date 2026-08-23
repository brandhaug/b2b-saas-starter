import { layerFromD1 } from '@b2b-saas-starter/db/src/service.ts'
import { Layer } from 'effect'
import { type WebhookQueueBinding } from './developer-platform/webhook-publisher.ts'
import { type WorkspaceInvitationBinding } from './governance/workspace-invitations.ts'
import { type WorkspaceLifecycleBinding } from './governance/workspace-lifecycle.ts'
import { type WorkspaceMemberBinding } from './governance/workspace-membership.ts'
import { type PlatformUserAdminBinding } from './governance/platform-user-admin.ts'
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
}

export function selectCapabilitiesLayer(env: StarterEnv): CapabilitiesLayer {
  if (env.DB === undefined) {
    return SeedLayer
  }
  const live = makeLiveLayerFromD1(env.DB, {
    webhookQueue: env.WEBHOOK_QUEUE,
    memberBinding: env.memberBinding,
    invitationBinding: env.invitationBinding,
    lifecycleBinding: env.lifecycleBinding,
    userAdminBinding: env.userAdminBinding
  })
  return live
}

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
    makeLiveCapabilitiesLayer({
      webhookQueue: env.WEBHOOK_QUEUE,
      memberBinding: env.memberBinding,
      invitationBinding: env.invitationBinding,
      lifecycleBinding: env.lifecycleBinding,
      userAdminBinding: env.userAdminBinding
    }),
    liveWorkspaceContext(slug, actor)
  ).pipe(Layer.provide(layerFromD1(env.DB)))
}
