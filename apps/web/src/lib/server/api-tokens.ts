import {
  ApiTokenRegistry,
  ApiTokenScope,
  type ApiToken,
  type CreatedApiToken,
  type RevokeApiTokenInput
} from '@b2b-saas-starter/capabilities/src/developer-platform/api-token-registry.ts'
import { type AuthorizationDenied } from '@b2b-saas-starter/authz/src/errors.ts'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/src/errors.ts'
import { WorkspaceContext } from '@b2b-saas-starter/capabilities/src/workspace-context.ts'
import { type WorkspaceRole } from '@b2b-saas-starter/capabilities/src/governance/workspace-identity.ts'
import { NotificationFeed } from '@b2b-saas-starter/capabilities/src/notifications/notification-feed.ts'
import { createServerFn } from '@tanstack/react-start'
import { Effect, Schema, type Scope } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'

// All input constraints live in the schema — no imperative re-validation.
const CreateApiTokenInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  name: Schema.NonEmptyString.check(Schema.isMaxLength(80)),
  scopes: Schema.NonEmptyArray(ApiTokenScope)
})

// The schema decoder IS the boundary contract: passing it as the validator
// keeps the untyped wire value inside `decodeUnknownSync` and hands the handler
// the decoded domain type.
const decodeInput = Schema.decodeUnknownSync(CreateApiTokenInput)

export const createApiTokenServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeInput(input))
  .handler(async ({ data }): Promise<CreatedApiToken> => {
    const session = await requireRequestSession()
    return runWorkspaceCapabilities(
      data.workspaceSlug,
      Effect.gen(function* () {
        // The session gate above proves who is asking; this proves they may.
        yield* requireWorkspacePermission({ apiToken: ['create'] })
        const tokens = yield* ApiTokenRegistry
        return yield* tokens.create({
          name: data.name,
          scopes: data.scopes,
          actorUserId: session.user.id
        })
      }),
      { userId: session.user.id }
    )
  })

/**
 * The API tokens payload.
 *
 * Unlike the members roster, reading tokens is itself a permission:
 * `apiToken:list` is withheld from a plain `member`, so the page hard-gates on
 * it — a member meeting the URL directly gets the denial, not an empty list.
 */
export type WorkspaceApiTokensPayload = {
  readonly viewer: { readonly role: WorkspaceRole } | null
  readonly unreadCount: number
  readonly tokens: readonly ApiToken[]
}

/**
 * `apiToken:list` is the page's own read permission and a hard gate.
 */
const apiTokensPayload: Effect.Effect<
  WorkspaceApiTokensPayload,
  AuthorizationDenied | CapabilityUnavailable,
  Scope.Scope | WorkspaceContext | ApiTokenRegistry | NotificationFeed
> = Effect.gen(function* () {
  yield* requireWorkspacePermission({ apiToken: ['list'] })
  const ctx = yield* WorkspaceContext
  const tokens = yield* ApiTokenRegistry
  const feed = yield* NotificationFeed
  const [unreadCount, list] = yield* Effect.all([feed.unreadCount, tokens.list], {
    concurrency: 'unbounded'
  })
  return {
    viewer: ctx.actor ? { role: ctx.actor.role } : null,
    unreadCount,
    tokens: list
  }
})

/** The API tokens route's loader. */
export function loadWorkspaceApiTokens(input: {
  readonly workspaceSlug: string
  readonly userId: string
}): Promise<WorkspaceApiTokensPayload> {
  return runWorkspaceCapabilities(input.workspaceSlug, apiTokensPayload, {
    userId: input.userId
  })
}

// All input constraints live in the schema — no imperative re-validation.
const RevokeApiTokenInputSchema = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  tokenId: Schema.NonEmptyString
})

const decodeRevokeInput = Schema.decodeUnknownSync(RevokeApiTokenInputSchema)

/**
 * The effect below the session gate: proves the actor may revoke
 * (`apiToken:revoke`, declared → enforced here), then hands the revocation to
 * the capability. Exported so tests drive it against fixture layers without a
 * request or an auth runtime. Revoking an unknown id is not an error — the
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

export const revokeApiTokenServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeRevokeInput(input))
  .handler(async ({ data }): Promise<boolean> => {
    const session = await requireRequestSession()
    return runWorkspaceCapabilities(
      data.workspaceSlug,
      revokeApiToken({
        tokenId: data.tokenId,
        actorUserId: session.user.id
      }),
      { userId: session.user.id }
    )
  })
