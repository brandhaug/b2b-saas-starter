import {
  ApiTokenRegistry,
  ApiTokenScope,
  type CreatedApiToken,
  type RevokeApiTokenInput
} from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { type AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import { type WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import { Effect, Schema, type Scope } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'
import { unreadCount, workspacePage, type WorkspacePageFrame } from './page-frame'
import { type WorkspaceApiTokensPayload } from './api-tokens'

/**
 * The API-tokens payload composition, the revoke effect and their
 * server-only wiring, reached only through dynamic `import()` inside the
 * handlers of `api-tokens.ts`: handler bodies are stripped from the client
 * build, so this graph ships to the server alone. `api-tokens.ts` holds the
 * client-safe half and the reason for the split.
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

/**
 * The loader as a plain function, so tests drive it directly with fixture
 * actors (`api-tokens.test.ts`) — no request, no auth runtime. The actor is
 * the session's user; the layout route's gate has already proved
 * membership, and `runWorkspaceCapabilities` re-proves it server-side.
 */
export function loadWorkspaceApiTokens(input: {
  readonly workspaceSlug: string
  readonly userId: string
}): Promise<WorkspaceApiTokensPayload> {
  return runWorkspaceCapabilities(input.workspaceSlug, apiTokensPayload, {
    userId: input.userId
  })
}

/**
 * The server fns' input schemas, decoded here rather than in
 * `api-tokens.ts`: the client stub never runs validators, and a module-level
 * Schema construct in the client-safe file would drag the Effect Schema
 * chunk onto every page. All input constraints live in the schema — no
 * imperative re-validation.
 */
const LoadApiTokensInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString
})

const CreateApiTokenInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  name: Schema.NonEmptyString.check(Schema.isMaxLength(80)),
  scopes: Schema.NonEmptyArray(ApiTokenScope)
})

const RevokeApiTokenInputSchema = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  tokenId: Schema.NonEmptyString
})

const decodeLoadInput = Schema.decodeUnknownSync(LoadApiTokensInput)
const decodeCreateInput = Schema.decodeUnknownSync(CreateApiTokenInput)
const decodeRevokeInput = Schema.decodeUnknownSync(RevokeApiTokenInputSchema)

export async function loadWorkspaceApiTokensHandler(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
  data: unknown
): Promise<WorkspaceApiTokensPayload> {
  const input = decodeLoadInput(data)
  const session = await requireRequestSession()
  return loadWorkspaceApiTokens({
    workspaceSlug: input.workspaceSlug,
    userId: session.user.id
  })
}

export async function createApiTokenHandler(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
  data: unknown
): Promise<CreatedApiToken> {
  const input = decodeCreateInput(data)
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      // The session gate above proves who is asking; this proves they may.
      yield* requireWorkspacePermission({ apiToken: ['create'] })
      const tokens = yield* ApiTokenRegistry
      // The entitlement gate and webhook fan-out live inside the capability,
      // below the interface — identical for every surface.
      return yield* tokens.create({
        name: input.name,
        scopes: input.scopes
      })
    }),
    { userId: session.user.id }
  )
}

/**
 * The effect below the session gate: proves the actor may revoke
 * (`apiToken:revoke`, declared → enforced here), then hands the revocation to
 * the capability. Exported so tests drive it against fixture layers without
 * a request or an auth runtime. Revoking an unknown id is not an error — the
 * capability resolves `false` and skips the audit row.
 */
export function revokeApiToken(
  input: RevokeApiTokenInput
): Effect.Effect<
  boolean,
  AuthorizationDenied | CapabilityUnavailable,
  Scope.Scope | WorkspaceContext | ApiTokenRegistry
> {
  return Effect.gen(function* () {
    yield* requireWorkspacePermission({ apiToken: ['revoke'] })
    const tokens = yield* ApiTokenRegistry
    return yield* tokens.revoke(input)
  })
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
export async function revokeApiTokenHandler(data: unknown): Promise<boolean> {
  const input = decodeRevokeInput(data)
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    revokeApiToken({
      tokenId: input.tokenId
    }),
    { userId: session.user.id }
  )
}
