import { Layer } from 'effect'
import { layerFromD1 } from '@b2b-saas-starter/db'
import type { WebhookQueueBinding } from './developer-platform/webhook-publisher.ts'
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
  WorkspaceContext,
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
}

export const selectCapabilitiesLayer = (env: StarterEnv): CapabilitiesLayer => {
  const base = env.DB
    ? makeLiveLayerFromD1(env.DB, { webhookQueue: env.WEBHOOK_QUEUE })
    : SeedLayer
  return withModuleEnvStatus(base, env.moduleConfig)
}

export const selectWorkspaceLayer = (
  env: StarterEnv,
  slug: string,
  actor?: ActorRef
): Layer.Layer<
  CapabilityServices | WorkspaceContext,
  WorkspaceNotFound | CapabilityUnavailable
> => {
  const base = env.DB
    ? Layer.mergeAll(
        makeLiveCapabilitiesLayer({ webhookQueue: env.WEBHOOK_QUEUE }),
        liveWorkspaceContext(slug, actor)
      ).pipe(Layer.provide(layerFromD1(env.DB)))
    : // Passing `seedMembers` makes the seed path enforce the same actor
      // membership semantics as the live path (fixture members allowed).
      Layer.merge(
        SeedLayer,
        seedWorkspaceContext(seedWorkspaceRecord, slug, actor, seedMembers)
      )
  return withModuleEnvStatus(base, env.moduleConfig)
}
