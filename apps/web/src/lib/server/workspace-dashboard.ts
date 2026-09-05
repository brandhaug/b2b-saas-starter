import { type ApiToken } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { type WebhookEndpoint } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { type AuditEvent } from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { type Invitation } from '@b2b-saas-starter/capabilities/governance/workspace-invitations'
import {
  type WorkspaceDashboardProjection,
  type WorkspaceProgressProjection
} from '@b2b-saas-starter/capabilities/workspace-projections'
import { type WorkspaceViewer } from '@/lib/permissions'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'

/**
 * The dashboard loader, in a **client-safe** module — the client-safe half
 * of the `workspace-dashboard.effects.ts` split (see apps/web/AGENTS.md for
 * the rule and `assert-client-boundary.mjs` for the enforcement). Each input
 * is written once, as its Effect Schema: the validator is the single strict
 * decode, and the derived type types both the client stub and the effects
 * handler.
 *
 * The behaviour is tested as the plain loader function in the effects file
 * (`workspace-dashboard.test.ts`), driven directly with fixture actors.
 */

/**
 * The dashboard payload, assembled per actor: the `workspaceDashboard`
 * projection (everything `notification:read` covers) plus the soft segments
 * the attention feed reads, each `null` for an actor without its permission,
 * plus the onboarding checklist, whose API-token and webhook steps are absent
 * for that same actor. A member gets the notifications panel and nothing
 * else — the segments are never read, so nothing permission-shaped reaches
 * their SSR payload. See `workspace-settings.ts` for why a permission-shaped
 * payload is declared in the app rather than in
 * `@b2b-saas-starter/capabilities`.
 */
export type WorkspaceDashboardPayload = WorkspaceDashboardProjection & {
  readonly viewer: WorkspaceViewer | null
  readonly webhooks: ReadonlyArray<WebhookEndpoint> | null
  readonly apiTokens: ReadonlyArray<ApiToken> | null
  readonly invitations: ReadonlyArray<Invitation> | null
  /** The newest audit events, for the dashboard's trailing activity card. */
  readonly auditEvents: ReadonlyArray<AuditEvent> | null
  readonly progress: WorkspaceProgressProjection
}

const WorkspaceDashboardInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString
})

export type WorkspaceDashboardInput = typeof WorkspaceDashboardInput.Type

/** The dashboard route's loader. */
export const loadWorkspaceDashboardServerFn = createServerFn({ method: 'GET' })
  .validator(Schema.decodeUnknownSync(WorkspaceDashboardInput))
  .handler(async ({ data }): Promise<WorkspaceDashboardPayload> => {
    const { loadWorkspaceDashboardHandler } =
      await import('./workspace-dashboard.effects')
    return loadWorkspaceDashboardHandler(data)
  })
