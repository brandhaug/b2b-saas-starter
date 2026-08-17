import { Layer } from 'effect'
import { layerFromD1 } from '@b2b-saas-starter/db'
import type { WebhookQueueBinding } from './developer-platform/webhook-publisher.ts'
import type { WorkspaceInvitationBinding } from './governance/workspace-invitations.ts'
import type { WorkspaceMemberBinding } from './governance/workspace-membership.ts'
import {
  makeLiveCapabilitiesLayer,
  makeLiveLayerFromD1,
  SeedLayer,
  type CapabilitiesLayer,
  type CapabilityServices
} from './layers.ts'
import { withModuleEnvStatus, type ModuleEnvStatus } from './module-env-overlay.ts'
import { seedMembers, seedWorkspaceRecord } from './seed-fixture.ts'
import {
  liveWorkspaceContext,
  seedWorkspaceContext,
  type WorkspaceContext,
  type ActorRef
} from './workspace-context.ts'
import type { CapabilityUnavailable, WorkspaceNotFound } from './errors.ts'

type D1Binding = Parameters<typeof layerFromD1>[0]

export type StarterEnv = {
  readonly DB?: D1Binding | undefined
  readonly WEBHOOK_QUEUE?: WebhookQueueBinding | undefined
  /**
   * Env-derived module configuration, computed by the app from its real
   * worker env via `moduleConfigStatus(readServerEnv(env))` in
   * `@b2b-saas-starter/env`. When present, `StarterModuleCatalog` and
   * `IntegrationSurfaces` report these statuses instead of stored fixture
   * state — a module with unset env vars shows needs-config (ADR 0035).
   */
  readonly moduleConfig?: readonly ModuleEnvStatus[] | undefined
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
}

export function selectCapabilitiesLayer(env: StarterEnv): CapabilitiesLayer {
  if (env.DB === undefined) {
    return withModuleEnvStatus(SeedLayer, env.moduleConfig)
  }
  const live = makeLiveLayerFromD1(env.DB, {
    webhookQueue: env.WEBHOOK_QUEUE,
    memberBinding: env.memberBinding,
    invitationBinding: env.invitationBinding
  })
  return withModuleEnvStatus(live, env.moduleConfig)
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
    const seeded = Layer.merge(
      SeedLayer,
      seedWorkspaceContext(seedWorkspaceRecord, slug, actor, seedMembers)
    )
    return withModuleEnvStatus(seeded, env.moduleConfig)
  }
  const live = Layer.mergeAll(
    makeLiveCapabilitiesLayer({
      webhookQueue: env.WEBHOOK_QUEUE,
      memberBinding: env.memberBinding,
      invitationBinding: env.invitationBinding
    }),
    liveWorkspaceContext(slug, actor)
  ).pipe(Layer.provide(layerFromD1(env.DB)))
  return withModuleEnvStatus(live, env.moduleConfig)
}
