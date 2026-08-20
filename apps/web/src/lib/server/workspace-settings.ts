import { Effect, type Scope } from 'effect'
import { type AuthorizationDenied } from '@b2b-saas-starter/authz'
import {
  ApiTokenRegistry,
  type CapabilityUnavailable,
  NotificationFeed,
  StarterModuleCatalog,
  WebhookEndpoints,
  WorkspaceContext,
  WorkspaceInvitations,
  type Invitation,
  type StarterModuleWithState,
  type WorkspaceRole
} from '@b2b-saas-starter/capabilities'
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
  readonly viewer: { readonly role: WorkspaceRole } | null
  readonly modules: readonly StarterModuleWithState[]
  readonly unreadCount: number
  readonly apiTokenCount: number | null
  readonly webhookCount: number | null
  readonly invitations: readonly Invitation[] | null
}

/**
 * `module:read` is the page's own read permission and a hard gate: an actor who
 * cannot read module state has no settings page to render, so that is a 403
 * rather than an empty shell. Everything below it is a soft gate — the page
 * renders, minus the section.
 *
 * `unreadCount` rides with the modules because every role in the matrix holds
 * `notification:read` alongside `module:read`; the matrix test in
 * `packages/authz` fails if that stops being true.
 */
const settingsPayload: Effect.Effect<
  WorkspaceSettingsPayload,
  AuthorizationDenied | CapabilityUnavailable,
  | Scope.Scope
  | WorkspaceContext
  | StarterModuleCatalog
  | ApiTokenRegistry
  | WebhookEndpoints
  | NotificationFeed
  | WorkspaceInvitations
> = Effect.gen(function* () {
  yield* requireWorkspacePermission({ module: ['read'] })
  const ctx = yield* WorkspaceContext
  const catalog = yield* StarterModuleCatalog
  const feed = yield* NotificationFeed
  const tokens = yield* ApiTokenRegistry
  const webhooks = yield* WebhookEndpoints
  const invites = yield* WorkspaceInvitations
  const [modules, unreadCount, apiTokenCount, webhookCount, invitations] =
    yield* Effect.all(
      [
        catalog.listModules,
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
    modules,
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
