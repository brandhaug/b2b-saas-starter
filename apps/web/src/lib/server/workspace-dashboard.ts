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

import { expectRecord, expectString } from './input-shape'

/**
 * The dashboard loader, in a **client-safe** module.
 *
 * This file is statically imported by the workspace index route (and its
 * payload type by `/demo`), and the route tree ships to the browser — so
 * everything at this module's top level rides on every page. That is why the
 * payload assembly and its imports (the capability services, the permission
 * helpers, the projections) live in `workspace-dashboard.effects.ts` and are
 * reached only through dynamic `import()` inside the handler: TanStack Start
 * strips handler bodies from the client build, so the capabilities graph
 * never ships, while the payload type still does.
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

type WorkspaceDashboardInput = {
  readonly workspaceSlug: string
}

/**
 * The server fn's validator, a plain shape check that runs on the server only
 * (TanStack strips `.validator()` from the client build): it is the server's
 * first decode, and the strict schema decodes again in
 * `workspace-dashboard.effects.ts`.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
function decodeDashboardInput(input: unknown): WorkspaceDashboardInput {
  const record = expectRecord(input, 'dashboard input')
  return { workspaceSlug: expectString(record, 'workspaceSlug', 'dashboard input') }
}

/** The dashboard route's loader. */
export const loadWorkspaceDashboardServerFn = createServerFn({ method: 'GET' })
  .validator(decodeDashboardInput)
  .handler(async ({ data }): Promise<WorkspaceDashboardPayload> => {
    const { loadWorkspaceDashboardHandler } =
      await import('./workspace-dashboard.effects')
    return loadWorkspaceDashboardHandler(data)
  })
