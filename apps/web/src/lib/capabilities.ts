import { Effect } from 'effect'
import {
  selectWorkspaceLayer,
  WorkspaceContext,
  WorkspaceNotFound,
  type AdoptionReadiness,
  type ApiTokenRegistry,
  type AuditEventLog,
  type CatalogRefreshHistory,
  type ImplementationReports,
  type IntegrationSurfaces,
  type NotificationFeed,
  type StarterModuleCatalog,
  type WebhookEndpoints,
  type WorkspaceMembership
} from '@b2b-saas-starter/capabilities'

export type CapabilityServices =
  | AdoptionReadiness
  | ApiTokenRegistry
  | AuditEventLog
  | CatalogRefreshHistory
  | ImplementationReports
  | IntegrationSurfaces
  | NotificationFeed
  | StarterModuleCatalog
  | WebhookEndpoints
  | WorkspaceMembership

const env: { readonly DB?: D1Database } = {}

export const runWorkspaceCapabilities = <
  A,
  E,
  R extends CapabilityServices | WorkspaceContext
>(
  workspaceSlug: string,
  effect: Effect.Effect<A, E, R>
): Promise<A> =>
  Effect.runPromise(
    Effect.provide(effect, selectWorkspaceLayer(env, workspaceSlug)) as Effect.Effect<
      A,
      E | WorkspaceNotFound
    >
  )
