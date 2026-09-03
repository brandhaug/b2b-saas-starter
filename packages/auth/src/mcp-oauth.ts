import {
  MCP_OFFLINE_ACCESS_SCOPE,
  MCP_READ_SCOPE,
  MCP_WORKSPACE_ID_CLAIM,
  MCP_WORKSPACE_ROLE_CLAIM,
  MCP_WORKSPACE_SLUG_CLAIM
} from '@b2b-saas-starter/authz/mcp-access-token'
import { type DrizzleDatabase } from '@b2b-saas-starter/db/client'
import { workspaceMembers, workspaces } from '@b2b-saas-starter/db/schema'
import { APIError } from 'better-auth/api'
import { and, eq } from 'drizzle-orm'

/**
 * The starter's half of the `@better-auth/mcp` configuration (ADR 0054): how
 * the consent page's workspace pick becomes a token claim, and nothing else.
 *
 * Better Auth invokes every callback here outside any Effect, so this module
 * is plain async over the promise drizzle client — the same platform-adapter
 * exemption `index.ts` already claims for the `additionalFields` callbacks.
 * The two `effect/noAsyncFunction` disables below are that exemption, stated
 * at the two places it applies; there is no Effect runtime to compose with.
 */

/** The pages the provider redirects to; the web app owns both routes. */
export const MCP_LOGIN_PAGE = '/sign-in'
export const MCP_CONSENT_PAGE = '/oauth/consent'

/**
 * The scopes an MCP Client may request. `openid`/`profile`/`email` let a
 * client show who is connected; `offline_access` mints a refresh token so the
 * connection survives the one-hour access token; `mcp:read` is what the
 * resource server requires. Nothing here grants a permission — the Member's
 * role does, re-resolved on every MCP call.
 */
export const MCP_OAUTH_SCOPES = [
  'openid',
  'profile',
  'email',
  MCP_OFFLINE_ACCESS_SCOPE,
  MCP_READ_SCOPE
]

/**
 * The header the consent server function sets on its `oauth2/continue` call to
 * say "the workspace on this session was picked for this authorization". Its
 * value is the picked workspace id; `postLogin.shouldRedirect` sends every
 * request without a matching header to the consent page. That is what makes
 * the pick per-authorization: a browser-initiated `/oauth2/authorize` never
 * carries it, so a stale `activeOrganizationId` from an earlier flow cannot
 * skip the picker.
 */
export const MCP_WORKSPACE_SELECTED_HEADER = 'x-starter-oauth-workspace'

/** The one session field this flow reads — see `packages/auth/AGENTS.md`, invariant 2. */
type SessionWithActiveWorkspace = {
  readonly id: string
  readonly activeOrganizationId?: string | null | undefined
}

/**
 * The plugin's "does the user still have to pick?" decision. `true` unless the
 * request itself vouches for the workspace on the session.
 */
export function mcpWorkspaceNeedsSelection(
  headers: Headers,
  session: SessionWithActiveWorkspace
): boolean {
  const selected = headers.get(MCP_WORKSPACE_SELECTED_HEADER)
  return !selected || selected !== session.activeOrganizationId
}

/**
 * The consent's `referenceId`: the picked workspace. Thrown as the plugin's
 * own error type when the session carries none, so an authorization that
 * somehow skipped the picker fails instead of minting a workspace-less token.
 */
export function mcpWorkspaceReferenceId(
  session: SessionWithActiveWorkspace | undefined
): string {
  const workspaceId = session?.activeOrganizationId
  if (!workspaceId) {
    // oxlint-disable-next-line effect/noThrowStatement -- Better Auth's option callbacks signal failure by throwing its APIError; there is no Effect channel here
    throw new APIError('BAD_REQUEST', {
      error: 'workspace_required',
      error_description: 'pick a workspace before consenting'
    })
  }
  return workspaceId
}

/**
 * The starter's claims on an MCP access token: the picked workspace and the
 * Member's role in it, read from D1 at issuance (and on every refresh — the
 * plugin calls this for both). A user who lost their membership since
 * consenting gets no token rather than a token naming a workspace they left.
 */
// oxlint-disable-next-line effect/noAsyncFunction -- see the module doc: Better Auth's callback runs outside any Effect
export async function mcpWorkspaceAccessTokenClaims(
  db: DrizzleDatabase,
  input: {
    readonly userId: string | undefined
    readonly referenceId: string | undefined
  }
): Promise<Record<string, string>> {
  if (input.userId === undefined || input.referenceId === undefined) {
    // oxlint-disable-next-line effect/noThrowStatement -- see mcpWorkspaceReferenceId
    throw new APIError('BAD_REQUEST', {
      error: 'workspace_required',
      error_description: 'MCP access tokens are issued for one workspace'
    })
  }
  // oxlint-disable-next-line effect/noAsyncFunction -- see the module doc: no Effect runtime reaches this callback
  const rows = await db
    .select({ workspace: workspaces, member: workspaceMembers })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaceMembers.workspaceId, input.referenceId),
        eq(workspaceMembers.userId, input.userId)
      )
    )
    .limit(1)
  const row = rows[0]
  if (!row) {
    // oxlint-disable-next-line effect/noThrowStatement -- see mcpWorkspaceReferenceId
    throw new APIError('FORBIDDEN', {
      error: 'not_a_member',
      error_description: 'the user is not a member of the consented workspace'
    })
  }
  return {
    [MCP_WORKSPACE_ID_CLAIM]: row.workspace.id,
    [MCP_WORKSPACE_SLUG_CLAIM]: row.workspace.slug,
    [MCP_WORKSPACE_ROLE_CLAIM]: row.member.role
  }
}
