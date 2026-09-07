import { requireTokenScopes } from '@b2b-saas-starter/authz/guard'
import { memberPrincipal } from '@b2b-saas-starter/authz/client'
import { WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import {
  ApiTokenRegistry,
  type ReplacedApiToken,
  type CreatedApiToken
} from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { Effect } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'
import { unreadCount, workspacePage, type WorkspacePageFrame } from './page-frame'
import {
  type CreateApiTokenInput,
  type LoadApiTokensInput,
  type RevokeApiTokenInput,
  type ReplaceApiTokenInput,
  type WorkspaceApiTokensPayload
} from './api-tokens'
import { makeSecurityEvidenceSink } from './security-evidence-sink'

/**
 * The API-tokens payload composition, the revoke effect and their
 * server-only wiring, reached only through dynamic `import()` inside the
 * handlers of `api-tokens.ts` (see apps/web/AGENTS.md). `api-tokens.ts`
 * holds the client-safe half and the reason for the split.
 */

/**
 * `apiToken:list` is the page's own read permission and a hard gate.
 */
const apiTokensPayload: WorkspacePageFrame<WorkspaceApiTokensPayload> = workspacePage(
  { apiToken: ['list'] },
  () =>
    Effect.all(
      {
        unreadCount,
        tokens: Effect.flatMap(ApiTokenRegistry, (registry) => registry.list)
      },
      { concurrency: 'unbounded' }
    )
)

export async function loadWorkspaceApiTokensHandler(
  input: LoadApiTokensInput
): Promise<WorkspaceApiTokensPayload> {
  // The actor is the session's user; the layout route's gate has already
  // proved membership, and `runWorkspaceCapabilities` re-proves it
  // server-side.
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(input.workspaceSlug, apiTokensPayload, {
    userId: session.user.id
  })
}

export async function createApiTokenHandler({
  workspaceSlug,
  ...input
}: CreateApiTokenInput): Promise<CreatedApiToken> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    workspaceSlug,
    Effect.gen(function* () {
      // The session gate above proves who is asking; this proves they may.
      yield* requireWorkspacePermission({ apiToken: ['create'] })
      const ctx = yield* WorkspaceContext
      const principal = ctx.actor ? memberPrincipal(ctx.actor.role) : null
      yield* requireTokenScopes(principal, input.scopes)
      const tokens = yield* ApiTokenRegistry
      // The entitlement gate and webhook fan-out live inside the capability,
      // below the interface — identical for every surface.
      return yield* tokens.create(input)
    }),
    { userId: session.user.id }
  )
}

export async function revokeApiTokenHandler(
  input: RevokeApiTokenInput
): Promise<boolean> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      // Proves the actor may revoke (`apiToken:revoke`, declared → enforced
      // here). Revoking an unknown id is not an error — the capability
      // resolves `false` and skips the audit row.
      yield* requireWorkspacePermission({ apiToken: ['revoke'] })
      const tokens = yield* ApiTokenRegistry
      return yield* tokens.revoke({ tokenId: input.tokenId })
    }),
    { userId: session.user.id },
    { securityEvidence: makeSecurityEvidenceSink() }
  )
}

export async function replaceApiTokenHandler({
  workspaceSlug,
  ...input
}: ReplaceApiTokenInput): Promise<ReplacedApiToken> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    workspaceSlug,
    Effect.gen(function* () {
      yield* requireWorkspacePermission({ apiToken: ['create'] })
      const ctx = yield* WorkspaceContext
      const principal = ctx.actor ? memberPrincipal(ctx.actor.role) : null
      yield* requireTokenScopes(principal, input.scopes)
      const tokens = yield* ApiTokenRegistry
      return yield* tokens.replace(input)
    }),
    { userId: session.user.id }
  )
}
