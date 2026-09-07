import {
  MCP_OFFLINE_ACCESS_SCOPE,
  MCP_READ_SCOPE,
  MCP_WRITE_SCOPE,
  MCP_CONSENT_CLAIM,
  MCP_WORKSPACE_ID_CLAIM,
  MCP_WORKSPACE_ROLE_CLAIM,
  MCP_WORKSPACE_SLUG_CLAIM,
  MCP_SSO_SESSION_CLAIM
} from '@b2b-saas-starter/authz/mcp-access-token'
import { type DrizzleDatabase } from './ports.ts'
import {
  oauthConsent,
  session,
  workspaceMembers,
  workspaceSsoAuthProofs,
  workspaceSsoConnections,
  workspaces
} from '@b2b-saas-starter/db/schema'
import { APIError } from 'better-auth/api'
import { and, eq, gt, isNull } from 'drizzle-orm'

/**
 * The starter's half of the `@better-auth/mcp` configuration (ADR 0068): how
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

/** Binds an existing plugin-issued consent to the session that authorized it. */
export type McpConsentSession = {
  readonly userId: string
  readonly clientId: string
  readonly workspaceId: string
  readonly sessionId: string
}

// oxlint-disable-next-line effect/noAsyncFunction -- server-only auth adapter, called after the provider has issued its consent
export async function bindMcpConsentSession(
  db: DrizzleDatabase,
  input: McpConsentSession
): Promise<void> {
  // oxlint-disable-next-line effect/noGlobals -- Better Auth's Promise adapter uses the same real clock as its sessions
  const now = new Date()
  // oxlint-disable-next-line effect/noAsyncFunction -- same Promise adapter boundary
  const [current] = await db
    .select({ id: session.id })
    .from(session)
    .where(
      and(
        eq(session.id, input.sessionId),
        eq(session.userId, input.userId),
        gt(session.expiresAt, now),
        isNull(session.impersonatedBy)
      )
    )
    .limit(1)
  if (current === undefined) {
    // oxlint-disable-next-line effect/noThrowStatement -- reject the server-side binding with Better Auth's error type
    throw new APIError('FORBIDDEN', { error: 'session_required' })
  }
  // Only the starter's session binding changes; the provider owns scopes and consent creation.
  // oxlint-disable-next-line effect/noAsyncFunction -- same Promise adapter boundary
  const updated = await db
    .update(oauthConsent)
    .set({ ssoSessionId: input.sessionId })
    .where(
      and(
        eq(oauthConsent.userId, input.userId),
        eq(oauthConsent.clientId, input.clientId),
        eq(oauthConsent.referenceId, input.workspaceId)
      )
    )
    .returning({ id: oauthConsent.id })
  if (updated.length === 0) {
    // oxlint-disable-next-line effect/noThrowStatement -- a missing consent must not return an apparently usable authorization code
    throw new APIError('FORBIDDEN', { error: 'consent_required' })
  }
}

/**
 * The scopes an MCP Client may request. `openid`/`profile`/`email` let a
 * client show who is connected; `offline_access` mints a refresh token so the
 * connection survives the one-hour access token; `mcp:read` is what the
 * resource server requires. `mcp:write` explicitly consents to mutations;
 * the current Member role still limits each operation.
 */
export const MCP_OAUTH_SCOPES = [
  'openid',
  'profile',
  'email',
  MCP_OFFLINE_ACCESS_SCOPE,
  MCP_READ_SCOPE,
  MCP_WRITE_SCOPE
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
 * request itself vouches for the workspace on the session. The parameter is
 * the plugin's own callback bag, so the options object assigns this function
 * directly — no rename wrapper.
 */
export function mcpWorkspaceNeedsSelection(input: {
  readonly headers: Headers
  readonly session: SessionWithActiveWorkspace
}): boolean {
  const selected = input.headers.get(MCP_WORKSPACE_SELECTED_HEADER)
  return !selected || selected !== input.session.activeOrganizationId
}

/**
 * The consent's `referenceId`: the picked workspace. Thrown as the plugin's
 * own error type when the session carries none, so an authorization that
 * somehow skipped the picker fails instead of minting a workspace-less token.
 * The parameter is the plugin's own callback bag, so the options object
 * assigns this function directly.
 */
export function mcpWorkspaceReferenceId(input: {
  readonly session: SessionWithActiveWorkspace | undefined
}): string {
  const workspaceId = input.session?.activeOrganizationId
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
    readonly clientId: string
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
  // oxlint-disable-next-line effect/noGlobals -- Better Auth token issuance is a Promise platform boundary
  const now = new Date()
  // oxlint-disable-next-line effect/noAsyncFunction -- see the module doc: no Effect runtime reaches this callback
  const rows = await db
    .select({
      workspace: workspaces,
      member: workspaceMembers,
      consent: {
        id: oauthConsent.id,
        version: oauthConsent.grantVersion,
        ssoSessionId: oauthConsent.ssoSessionId
      },
      proof: workspaceSsoAuthProofs,
      connection: workspaceSsoConnections,
      session: { id: session.id }
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .leftJoin(
      oauthConsent,
      and(
        eq(oauthConsent.userId, workspaceMembers.userId),
        eq(oauthConsent.referenceId, workspaces.id),
        eq(oauthConsent.clientId, input.clientId)
      )
    )
    .leftJoin(
      workspaceSsoAuthProofs,
      and(
        eq(workspaceSsoAuthProofs.sessionId, oauthConsent.ssoSessionId),
        eq(workspaceSsoAuthProofs.workspaceId, input.referenceId),
        eq(workspaceSsoAuthProofs.userId, input.userId),
        gt(workspaceSsoAuthProofs.expiresAt, now.toISOString())
      )
    )
    .leftJoin(
      session,
      and(
        eq(session.id, oauthConsent.ssoSessionId),
        eq(session.userId, input.userId),
        gt(session.expiresAt, now),
        isNull(session.impersonatedBy)
      )
    )
    .leftJoin(
      workspaceSsoConnections,
      and(
        eq(workspaceSsoConnections.providerId, workspaceSsoAuthProofs.providerId),
        eq(workspaceSsoConnections.workspaceId, input.referenceId),
        eq(
          workspaceSsoConnections.connectionGeneration,
          workspaceSsoAuthProofs.connectionGeneration
        ),
        eq(workspaceSsoConnections.enabled, true)
      )
    )
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
  const ssoSessionId = row.consent?.ssoSessionId
  // oxlint-disable-next-line effect/noAsyncFunction -- Better Auth callback has no Effect runtime
  const required = await db
    .select({ providerId: workspaceSsoConnections.providerId })
    .from(workspaceSsoConnections)
    .where(
      and(
        eq(workspaceSsoConnections.workspaceId, input.referenceId),
        eq(workspaceSsoConnections.requireSso, true)
      )
    )
  if (required.length > 0) {
    if (
      row.proof === null ||
      row.connection === null ||
      row.session === null ||
      !required.some(
        (connection) => connection.providerId === row.connection?.providerId
      )
    ) {
      // oxlint-disable-next-line effect/noThrowStatement -- Better Auth requires its typed APIError at the issuance boundary
      throw new APIError('FORBIDDEN', {
        error: 'sso_proof_required',
        error_description: 'the authenticated SSO proof is expired or revoked'
      })
    }
  }
  const claims = {
    [MCP_WORKSPACE_ID_CLAIM]: row.workspace.id,
    [MCP_WORKSPACE_SLUG_CLAIM]: row.workspace.slug,
    [MCP_WORKSPACE_ROLE_CLAIM]: row.member.role
  }
  if (row.consent) {
    if (ssoSessionId !== null && ssoSessionId !== undefined) {
      return {
        ...claims,
        [MCP_SSO_SESSION_CLAIM]: ssoSessionId,
        [MCP_CONSENT_CLAIM]: `${row.consent.id}:${row.consent.version}`
      }
    }
    return {
      ...claims,
      [MCP_CONSENT_CLAIM]: `${row.consent.id}:${row.consent.version}`
    }
  }
  return claims
}
