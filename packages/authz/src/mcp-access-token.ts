import { workspaceRoles } from '@b2b-saas-starter/db/enums'
import { Schema } from 'effect'

/**
 * The access-token contract between the web worker (the OAuth 2.1
 * authorization server, `packages/auth`) and the API worker (the MCP resource
 * server, `apps/api`) — ADR 0055. Both sides import these names from here, so
 * a claim the issuer stamps and a claim the verifier reads cannot drift.
 *
 * This package is the one both workers already share below `capabilities`; it
 * owns the permission vocabulary, and the OAuth scope an MCP Client asks for is
 * part of that vocabulary.
 */

/**
 * The one scope an MCP Client requests to use the MCP server. It is advertised
 * in the protected-resource metadata and required in every access token's
 * `scope` claim; `offline_access` rides beside it so a client can refresh
 * without a second sign-in.
 */
export const MCP_READ_SCOPE = 'mcp:read'
export const MCP_OFFLINE_ACCESS_SCOPE = 'offline_access'

/** What the resource server advertises as `scopes_supported`. */
export const MCP_RESOURCE_SCOPES: ReadonlyArray<string> = [
  MCP_READ_SCOPE,
  MCP_OFFLINE_ACCESS_SCOPE
]

/**
 * The starter's own claims on an MCP access token, beside the AS-owned
 * `iss`/`sub`/`aud`/`exp`/`scope`. Prefixed so they can never collide with a
 * registered JWT claim name; the API worker maps them onto the same
 * `WorkspaceContext` an API Token builds.
 */
export const MCP_WORKSPACE_ID_CLAIM = 'starter_workspace_id'
export const MCP_WORKSPACE_SLUG_CLAIM = 'starter_workspace_slug'
export const MCP_WORKSPACE_ROLE_CLAIM = 'starter_workspace_role'

/** Present exactly when the token is DPoP-bound (RFC 9449 §4); never accepted here. */
const cnf = Schema.optional(Schema.Unknown)

/** The verified, decoded payload of an MCP access token as the resource server reads it. */
export const McpAccessTokenClaims = Schema.Struct({
  /** Better Auth's `user.id` — the consenting Member. */
  sub: Schema.String,
  /** Space-separated OAuth scopes; must contain {@link MCP_READ_SCOPE}. */
  scope: Schema.String,
  [MCP_WORKSPACE_ID_CLAIM]: Schema.String,
  [MCP_WORKSPACE_SLUG_CLAIM]: Schema.String,
  [MCP_WORKSPACE_ROLE_CLAIM]: Schema.Literals(workspaceRoles),
  cnf
})
export type McpAccessTokenClaims = typeof McpAccessTokenClaims.Type

const decodeClaims = Schema.decodeUnknownResult(McpAccessTokenClaims)

/**
 * What the resource server acts on: the Member and the one Workspace the
 * consent named. The role is the role at issuance; the API worker re-resolves
 * membership on every call, so the claim is a hint for clients and logs, not
 * the authority.
 */
export type McpAccessTokenPrincipal = {
  readonly userId: string
  readonly workspaceId: string
  readonly workspaceSlug: string
  readonly workspaceRole: (typeof workspaceRoles)[number]
  readonly scopes: ReadonlyArray<string>
}

export type McpAccessTokenRejection =
  | 'malformed_claims'
  | 'missing_mcp_scope'
  | 'dpop_bound_token'

/**
 * Pure mapping from a verified JWT payload to the principal, or the reason it
 * is refused. Signature, issuer, audience and expiry are the verifier's job
 * (jose); this checks only what the starter itself stamped. The payload is
 * `unknown` on purpose — every claim it reads is re-validated by the schema,
 * so the module needs no JWT library to say what it accepts.
 */
export function mcpAccessTokenPrincipal(
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- a verified JWT payload IS an untrusted claim bag; parsing it is this function's whole job
  payload: Record<string, unknown>
):
  | { readonly ok: true; readonly principal: McpAccessTokenPrincipal }
  | { readonly ok: false; readonly reason: McpAccessTokenRejection } {
  const decoded = decodeClaims(payload)
  if (decoded._tag === 'Failure') {
    return { ok: false, reason: 'malformed_claims' }
  }
  // `cnf` means the token is DPoP-bound: it must ride a DPoP proof, which no
  // starter resource server implements — refuse it rather than accept it as a
  // bare bearer.
  if (decoded.success.cnf !== undefined) {
    return { ok: false, reason: 'dpop_bound_token' }
  }
  const claims = decoded.success
  const scopes = claims.scope.split(' ').filter((scope) => scope.length > 0)
  if (!scopes.includes(MCP_READ_SCOPE)) {
    return { ok: false, reason: 'missing_mcp_scope' }
  }
  return {
    ok: true,
    principal: {
      userId: claims.sub,
      workspaceId: claims[MCP_WORKSPACE_ID_CLAIM],
      workspaceSlug: claims[MCP_WORKSPACE_SLUG_CLAIM],
      workspaceRole: claims[MCP_WORKSPACE_ROLE_CLAIM],
      scopes
    }
  }
}
