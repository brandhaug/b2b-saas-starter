import { type AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import { type NotificationFeed } from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import {
  WebhookEndpoints,
  type WebhookEndpoint
} from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import {
  workspaceDashboard,
  type WorkspaceDashboardProjection
} from '@b2b-saas-starter/capabilities/workspace-projections'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import { type WorkspaceViewer } from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { Effect, type Scope } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { requireWorkspacePermission, whenPermitted } from './authorize'

/**
 * The dashboard payload, assembled per actor: the `workspaceDashboard`
 * projection (everything `notification:read` covers) plus the webhook segment, which
 * is `null` for an actor without `webhook:list`. See
 * `workspace-settings.ts` for why a permission-shaped payload is declared in
 * the app rather than in `@b2b-saas-starter/capabilities`.
 */
export type WorkspaceDashboardPayload = WorkspaceDashboardProjection & {
  readonly viewer: WorkspaceViewer | null
  readonly webhooks: readonly WebhookEndpoint[] | null
}

const dashboardPayload: Effect.Effect<
  WorkspaceDashboardPayload,
  AuthorizationDenied | CapabilityUnavailable,
  Scope.Scope | WorkspaceContext | WebhookEndpoints | NotificationFeed
> = Effect.gen(function* () {
  yield* requireWorkspacePermission({ notification: ['read'] })
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
