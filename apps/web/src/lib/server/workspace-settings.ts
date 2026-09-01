import { ApiTokenRegistry } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { WebhookEndpoints } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import {
  WorkspaceInvitations,
  type Invitation
} from '@b2b-saas-starter/capabilities/governance/workspace-invitations'
import { type WorkspaceViewer } from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { Effect } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { whenPermitted } from './authorize'
import { unreadCount, workspacePage, type WorkspacePageFrame } from './page-frame'

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
  readonly invitations: ReadonlyArray<Invitation> | null
}

/**
 * `notification:read` is the page's own read permission and a hard gate: an
 * actor who cannot read notifications has no settings page to render, so that
 * is a 403 rather than an empty shell. Everything below it is a soft gate —
 * the page renders, minus the section.
 */
const settingsPayload: WorkspacePageFrame<WorkspaceSettingsPayload> = workspacePage(
  { notification: ['read'] },
  (ctx) =>
    Effect.map(
      Effect.all(
        {
          unreadCount,
          apiTokenCount: whenPermitted(
            { apiToken: ['list'] },
            Effect.flatMap(ApiTokenRegistry, (tokens) =>
              Effect.map(tokens.list, (rows) => rows.length)
            )
          ),
          webhookCount: whenPermitted(
            { webhook: ['list'] },
            Effect.flatMap(WebhookEndpoints, (webhooks) =>
              Effect.map(webhooks.list, (rows) => rows.length)
            )
          ),
          // Reading the invitation list is the same right as managing it: the
          // statement has no `read` action, and a pending-invitation list is
          // workspace security posture in the same way an API-token list is.
          invitations: whenPermitted(
            { invitation: ['create'] },
            Effect.flatMap(WorkspaceInvitations, (invites) => invites.list)
          )
        },
        { concurrency: 'unbounded' }
      ),
      (segments) => ({ workspaceName: ctx.workspace.name, ...segments })
    )
)

/** The settings route's loader. */
export function loadWorkspaceSettings(input: {
  readonly workspaceSlug: string
  readonly userId: string
}): Promise<WorkspaceSettingsPayload> {
  return runWorkspaceCapabilities(input.workspaceSlug, settingsPayload, {
    userId: input.userId
  })
}
