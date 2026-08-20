import { Effect, type Scope } from 'effect'
import { type AuthorizationDenied } from '@b2b-saas-starter/authz'
import {
  type AdoptionReadiness,
  type CatalogRefreshHistory,
  type NotificationFeed,
  type StarterModuleCatalog,
  WebhookEndpoints,
  WorkspaceContext,
  workspaceDashboard,
  type CapabilityUnavailable,
  type WebhookEndpoint,
  type WorkspaceDashboardProjection,
  type WorkspaceRole
} from '@b2b-saas-starter/capabilities'
import { runWorkspaceCapabilities } from '../capabilities'
import { requireWorkspacePermission, whenPermitted } from './authorize'

/**
 * The dashboard payload, assembled per actor: the `workspaceDashboard`
 * projection (everything `module:read` covers) plus the webhook segment, which
 * is `null` for an actor without `webhook:list`. See
 * `workspace-settings.ts` for why a permission-shaped payload is declared in
 * the app rather than in `@b2b-saas-starter/capabilities`.
 */
export type WorkspaceDashboardPayload = WorkspaceDashboardProjection & {
  readonly viewer: { readonly role: WorkspaceRole } | null
  readonly webhooks: readonly WebhookEndpoint[] | null
}

const dashboardPayload: Effect.Effect<
  WorkspaceDashboardPayload,
  AuthorizationDenied | CapabilityUnavailable,
  | Scope.Scope
  | WorkspaceContext
  | WebhookEndpoints
  | StarterModuleCatalog
  | NotificationFeed
  | AdoptionReadiness
  | CatalogRefreshHistory
> = Effect.gen(function* () {
  yield* requireWorkspacePermission({ module: ['read'] })
  const ctx = yield* WorkspaceContext
  const webhooks = yield* WebhookEndpoints
  const [core, endpoints] = yield* Effect.all(
    [workspaceDashboard, whenPermitted({ webhook: ['list'] }, webhooks.list)],
    { concurrency: 'unbounded' }
  )
  return {
    ...core,
    viewer: ctx.actor ? { role: ctx.actor.role } : null,
    webhooks: endpoints
  }
})

/** The dashboard route's loader. */
export function loadWorkspaceDashboard(input: {
  readonly workspaceSlug: string
  readonly userId: string
}): Promise<WorkspaceDashboardPayload> {
  return runWorkspaceCapabilities(input.workspaceSlug, dashboardPayload, {
    userId: input.userId
  })
}
