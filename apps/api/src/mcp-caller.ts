import { McpClientConnections } from '@b2b-saas-starter/capabilities/developer-platform/mcp-client-connections'
import {
  WorkspaceSuspensionService,
  workspaceSuspensionOperationForPermission
} from '@b2b-saas-starter/capabilities/governance/workspace-suspension'
import {
  StrongAuthentication,
  StrongAuthenticationRequired
} from '@b2b-saas-starter/capabilities/governance/strong-authentication'
import { type WorkspaceExportRecipient } from '@b2b-saas-starter/capabilities/governance/workspace-export'
import {
  WorkspaceCaller,
  WorkspaceContext,
  type WorkspaceContextInterface
} from '@b2b-saas-starter/capabilities/workspace-context'
import { annotateWideEvent } from '@b2b-saas-starter/logger'
import { requirePermission } from '@b2b-saas-starter/authz/guard'
import {
  memberPrincipal,
  tokenPrincipal,
  needsStrongAuthentication,
  needsRecentAuthentication,
  type Principal,
  type PermissionRequest
} from '@b2b-saas-starter/authz/client'
import {
  type MCP_READ_SCOPE,
  type MCP_WRITE_SCOPE,
  type McpAccessTokenPrincipal
} from '@b2b-saas-starter/authz/mcp-access-token'
import {
  AUTHORIZATION_DENIED_REASONS,
  AuthorizationDenied
} from '@b2b-saas-starter/authz/errors'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { type ApiPrincipalValue } from '@b2b-saas-starter/api'
import { type Unauthorized } from '@b2b-saas-starter/api/errors'
import { type ApiTokenRegistry } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { Effect, type Scope } from 'effect'
import { type ApiEnv } from './env.ts'
import { looksLikeJwt, OAuthTokenVerifier } from './oauth-access-token.ts'
import { provideWorkspace, verifyToken } from './request-guards.ts'

/**
 * Who is calling the MCP server: a workspace API Token (scripts, CI) or an
 * OAuth access token minted for a signed-in Member by the web worker (Claude,
 * Cursor, …) — ADR 0068. Both name exactly one workspace; only the OAuth caller
 * names a user, which is what lets its calls resolve a real `Actor` and
 * authorize as that Member rather than as a scope set.
 */
type McpCallerTokens = {
  readonly token: ApiPrincipalValue
  readonly oauth: McpAccessTokenPrincipal
}
type McpCallerKind = keyof McpCallerTokens
type McpCallerOf<K extends McpCallerKind> = {
  readonly kind: K
  readonly token: McpCallerTokens[K]
}
export type McpCaller = { [K in McpCallerKind]: McpCallerOf<K> }[McpCallerKind]

type McpScope = typeof MCP_READ_SCOPE | typeof MCP_WRITE_SCOPE

/** Everything that differs between caller kinds, decided in one place. */
type McpCallerPolicy<Token> = {
  /**
   * The audit provenance and the Member the workspace layer resolves and
   * re-verifies, if any, as one value.
   */
  readonly caller: (token: Token) => WorkspaceCaller
  /**
   * Whom the call authorizes as. Consent and the required MCP scope bind only
   * where a client acts for a Member; an API Token's scopes are its authority.
   */
  readonly principal: (
    token: Token,
    ctx: WorkspaceContextInterface,
    requiredScope: McpScope
  ) => Effect.Effect<
    Principal,
    AuthorizationDenied | CapabilityUnavailable,
    McpClientConnections
  >
  /** Session assurance demanded beyond the permission itself. */
  readonly assurance: (
    token: Token,
    ctx: WorkspaceContextInterface,
    permission: PermissionRequest
  ) => Effect.Effect<
    void,
    StrongAuthenticationRequired | CapabilityUnavailable,
    StrongAuthentication
  >
  /** Who a workspace export link is minted for. */
  readonly exportRecipient: (
    token: Token
  ) => Effect.Effect<WorkspaceExportRecipient, StrongAuthenticationRequired>
}

function insufficientPermission() {
  return new AuthorizationDenied({
    reason: AUTHORIZATION_DENIED_REASONS.insufficientPermission
  })
}

/**
 * One policy per caller kind. The mapped type is what lets `mcpCallerPolicy`
 * index it by a caller's own kind and hand that policy the matching token.
 */
type McpCallerPolicies = {
  readonly [K in McpCallerKind]: McpCallerPolicy<McpCallerTokens[K]>
}

/** A new credential kind is a compile error here until each policy is chosen. */
const MCP_CALLER_POLICIES: McpCallerPolicies = {
  token: {
    caller: () => WorkspaceCaller.apiToken,
    principal: (token) => Effect.succeed(tokenPrincipal(token.scopes)),
    assurance: () => Effect.void,
    exportRecipient: () => Effect.succeed({ type: 'api_token' })
  },
  oauth: {
    caller: (token) => WorkspaceCaller.user(token.userId),
    principal: (token, ctx, requiredScope) =>
      Effect.gen(function* () {
        if (ctx.actor === null) {
          return yield* new AuthorizationDenied({
            reason: AUTHORIZATION_DENIED_REASONS.noPrincipal
          })
        }
        if (ctx.actor.banned) {
          return yield* insufficientPermission()
        }
        if (
          !token.scopes.includes(requiredScope) ||
          token.clientId === undefined ||
          token.consentBinding === undefined
        ) {
          return yield* insufficientPermission()
        }
        const connections = yield* McpClientConnections
        const grant = yield* connections.getGrant({
          userId: token.userId,
          clientId: token.clientId,
          workspaceId: token.workspaceId,
          resource: token.resource
        })
        if (
          grant?.binding !== token.consentBinding ||
          !grant.scopes.includes(requiredScope)
        ) {
          return yield* insufficientPermission()
        }
        return memberPrincipal(ctx.actor.role)
      }),
    assurance: (token, ctx, permission) =>
      Effect.gen(function* () {
        const strong = needsStrongAuthentication({
          systemRole: ctx.actor?.systemRole,
          workspaceRole: ctx.actor?.role
        })
        const recent = needsRecentAuthentication(permission)
        if (!strong && !recent) {
          return
        }
        if (token.sessionId === undefined) {
          return yield* new StrongAuthenticationRequired()
        }
        const authentication = yield* StrongAuthentication
        const session = { userId: token.userId, sessionId: token.sessionId }
        if (strong) {
          yield* authentication.require(session)
        }
        if (recent) {
          yield* authentication.requireRecent(session)
        }
      }),
    exportRecipient: (token) => {
      if (token.sessionId === undefined) {
        return Effect.fail(new StrongAuthenticationRequired())
      }
      return Effect.succeed({
        type: 'session',
        userId: token.userId,
        sessionId: token.sessionId
      })
    }
  }
}

/** The caller's policy with its own token bound in. */
export function mcpCallerPolicy<K extends McpCallerKind>(caller: McpCallerOf<K>) {
  const policy = MCP_CALLER_POLICIES[caller.kind]
  const token = caller.token
  return {
    caller: policy.caller(token),
    principal: (ctx: WorkspaceContextInterface, requiredScope: McpScope) =>
      policy.principal(token, ctx, requiredScope),
    assurance: (ctx: WorkspaceContextInterface, permission: PermissionRequest) =>
      policy.assurance(token, ctx, permission),
    exportRecipient: Effect.suspend(() => policy.exportRecipient(token))
  }
}

/**
 * The MCP protocol route's authentication: one `Authorization: Bearer`
 * credential, two shapes. A JWT (three segments) goes to the OAuth verifier —
 * signature against the issuer's JWKS, issuer, audience, expiry, then the
 * starter's own claims; anything else is an API Token and takes exactly the
 * path REST's `verifyToken` takes. The REST groups do not call this: OAuth is
 * for interactive clients, and the contract's `BearerAuth` stays token-only.
 * Resolved again for each write, including batched tool calls.
 */
export const verifyMcpCredential = Effect.fn('Mcp.verifyCredential')(function* (
  bearer: string | null
): Effect.fn.Return<
  McpCaller,
  Unauthorized | CapabilityUnavailable,
  ApiTokenRegistry | OAuthTokenVerifier | Scope.Scope
> {
  if (bearer !== null && looksLikeJwt(bearer)) {
    const verifier = yield* OAuthTokenVerifier
    const verified = yield* verifier.verify(bearer).pipe(
      Effect.tapError((failure) =>
        annotateWideEvent({
          outcome: 'unauthorized',
          authReason: failure.message,
          credential: 'oauth'
        })
      )
    )
    yield* annotateWideEvent({
      credential: 'oauth',
      actorUserId: verified.userId,
      workspaceId: verified.workspaceId
    })
    return { kind: 'oauth', token: verified }
  }
  const token = yield* verifyToken(bearer)
  yield* annotateWideEvent({ credential: 'api_token' })
  return { kind: 'token', token }
})

/**
 * Resolves the caller's own workspace, actor and audit provenance and provides
 * them to `body`. An OAuth caller who is no longer a Member fails while the
 * layer builds, as the typed `WorkspaceNotFound`.
 */
export function provideMcpWorkspace<A, E, R>(
  env: ApiEnv,
  caller: McpCaller,
  body: Effect.Effect<A, E, R>
) {
  const policy = mcpCallerPolicy(caller)
  return provideWorkspace(env, caller.token.workspaceSlug, body, policy.caller)
}

/** Current Workspace identity, role, and consent constrain every MCP operation. */
export const authorizeMcpOperation = Effect.fn('Mcp.authorizeOperation')(function* (
  caller: McpCaller,
  permission: PermissionRequest,
  requiredScope: McpScope
) {
  const ctx = yield* WorkspaceContext
  if (ctx.workspace.id !== caller.token.workspaceId) {
    return yield* new AuthorizationDenied({
      reason: AUTHORIZATION_DENIED_REASONS.tokenWorkspaceMismatch
    })
  }
  const policy = mcpCallerPolicy(caller)
  const principal = yield* policy.principal(ctx, requiredScope)
  yield* requirePermission(principal, permission)
  yield* policy.assurance(ctx, permission)
  const suspension = yield* WorkspaceSuspensionService
  yield* suspension.requireAllowed(
    ctx.workspace.id,
    workspaceSuspensionOperationForPermission(permission)
  )
  return principal
})
