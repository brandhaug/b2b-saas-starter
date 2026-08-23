import { type AuthorizationDenied } from '@b2b-saas-starter/authz/src/errors.ts'
import { ApiTokenRegistry } from '@b2b-saas-starter/capabilities/src/developer-platform/api-token-registry.ts'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/src/errors.ts'
import { NotificationFeed } from '@b2b-saas-starter/capabilities/src/notifications/notification-feed.ts'
import { WebhookEndpoints } from '@b2b-saas-starter/capabilities/src/developer-platform/webhook-endpoints.ts'
import { WorkspaceContext } from '@b2b-saas-starter/capabilities/src/workspace-context.ts'
import {
  WorkspaceInvitations,
  type Invitation
} from '@b2b-saas-starter/capabilities/src/governance/workspace-invitations.ts'
import { type WorkspaceViewer } from '@b2b-saas-starter/capabilities/src/governance/workspace-identity.ts'
import { Effect, type Scope } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { requireWorkspacePermission, whenPermitted } from './authorize'

/**
 * The workspace settings payload, assembled per actor.
 *
 * A `null` segment means the actor may not read it, and the read never ran —
 * this is a permission-shaped payload, which is why it is declared here rather
 * than in `@b2b-saas-starter/capabilities`: a capability does not check
 * authorization (see that package's intent node), so the projection it would
 * otherwise own cannot decide which segments exist.
 *
 * `viewer` carries the actor's workspace role to the client, where the same
 * pure `authorize()` decides whether a control renders. The server withholding
 * the data is the enforcement; the client check is what stops a member being
 * shown a form that would only fail on submit.
 */
export type WorkspaceSettingsPayload = {
  readonly viewer: WorkspaceViewer | null
  /** The workspace itself; every member may read its own name. */
  readonly workspaceName: string
  readonly unreadCount: number
  readonly apiTokenCount: number | null
  readonly webhookCount: number | null
  readonly invitations: readonly Invitation[] | null
}

/**
 * `notification:read` is the page's own read permission and a hard gate: an
 * actor who cannot read notifications has no settings page to render, so that
 * is a 403 rather than an empty shell. Everything below it is a soft gate —
 * the page renders, minus the section.
 */
const settingsPayload: Effect.Effect<
  WorkspaceSettingsPayload,
  AuthorizationDenied | CapabilityUnavailable,
  | Scope.Scope
  | WorkspaceContext
  | ApiTokenRegistry
  | WebhookEndpoints
  | NotificationFeed
  | WorkspaceInvitations
> = Effect.gen(function* () {
  yield* requireWorkspacePermission({ notification: ['read'] })
  const ctx = yield* WorkspaceContext
  const feed = yield* NotificationFeed
  const tokens = yield* ApiTokenRegistry
  const webhooks = yield* WebhookEndpoints
  const invites = yield* WorkspaceInvitations
  const [unreadCount, apiTokenCount, webhookCount, invitations] = yield* Effect.all(
    [
      feed.unreadCount,
      whenPermitted(
        { apiToken: ['list'] },
        Effect.map(tokens.list, (rows) => rows.length)
      ),
      whenPermitted(
        { webhook: ['list'] },
        Effect.map(webhooks.list, (rows) => rows.length)
      ),
      // Reading the invitation list is the same right as managing it: the
      // statement has no `read` action, and a pending-invitation list is
      // workspace security posture in the same way an API-token list is.
      whenPermitted({ invitation: ['create'] }, invites.list)
    ],

    { concurrency: 'unbounded' }
  )
  return {
    viewer: ctx.actor ? { role: ctx.actor.role } : null,
    workspaceName: ctx.workspace.name,
    unreadCount,
    apiTokenCount,
    webhookCount,
    invitations
  }
})

/** The settings route's loader. */
export function loadWorkspaceSettings(input: {
  readonly workspaceSlug: string
  readonly userId: string
}): Promise<WorkspaceSettingsPayload> {
  return runWorkspaceCapabilities(input.workspaceSlug, settingsPayload, {
    userId: input.userId
  })
}
