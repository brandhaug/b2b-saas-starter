import { apiTokenScopes } from '@b2b-saas-starter/db/schema'
import { Context, Schema, type Effect } from 'effect'

import {
  type AuthorizationDenied,
  type CapabilityUnavailable,
  type PlanLimitExceeded
} from '../errors.ts'
import { hashSha256 } from '../internal/crypto.ts'
import { type WorkspaceContext } from '../workspace-context.ts'

/**
 * The API token contract: the wire schemas, the service tag, the documented
 * fixture credentials, the `lastUsedAt` throttle policy, and the stored-hash
 * scheme. The in-memory adapter lives in
 * [`api-token-registry.seed.ts`](./api-token-registry.seed.ts), the D1 adapter
 * in [`api-token-registry.live.ts`](./api-token-registry.live.ts).
 *
 * The two `SEED_*` token constants stay here rather than in the Seed adapter:
 * they are published fixture credentials — the API worker's tests and the
 * local-development docs quote them — not an implementation detail of the
 * layer that happens to accept them.
 */

export const API_TOKEN_SCOPES = apiTokenScopes
export const ApiTokenScope = Schema.Literals(API_TOKEN_SCOPES)
export type ApiTokenScope = typeof ApiTokenScope.Type

export const ApiToken = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  prefix: Schema.String,
  scopes: Schema.Array(ApiTokenScope),
  lastUsedAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String
})
export type ApiToken = typeof ApiToken.Type

export type CreatedApiToken = ApiToken & {
  readonly token: string
}

export type VerifiedApiToken = {
  readonly id: string
  readonly workspaceId: string
  readonly workspaceSlug: string
  readonly scopes: ReadonlyArray<ApiTokenScope>
}

export type CreateApiTokenInput = {
  readonly name: string
  readonly scopes: ReadonlyArray<ApiTokenScope>
}

export const CreateApiTokenPayload = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  scopes: Schema.Array(ApiTokenScope).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(API_TOKEN_SCOPES.length)
  )
})
export type CreateApiTokenPayload = typeof CreateApiTokenPayload.Type

export const CreatedApiTokenSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  prefix: Schema.String,
  scopes: Schema.Array(ApiTokenScope),
  lastUsedAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  token: Schema.String
})

export type RevokeApiTokenInput = {
  readonly tokenId: string
}

export type ApiTokenRegistryInterface = {
  readonly list: Effect.Effect<
    ReadonlyArray<ApiToken>,
    CapabilityUnavailable,
    WorkspaceContext
  >

  readonly create: (
    input: CreateApiTokenInput
  ) => Effect.Effect<
    CreatedApiToken,
    CapabilityUnavailable | PlanLimitExceeded,
    WorkspaceContext
  >
  /** Resolves `true` when a token was revoked, `false` when nothing matched. */
  readonly revoke: (
    input: RevokeApiTokenInput
  ) => Effect.Effect<boolean, CapabilityUnavailable, WorkspaceContext>
  /**
   * Authenticates a bearer token: which token is this, whose workspace does it
   * belong to, and what scopes does it carry. It does **not** judge whether
   * those scopes cover the request — that is one `authorize()` decision made by
   * `requirePermission` at the route boundary, so there is no second
   * permission implementation to keep in step.
   */
  readonly verifyBearerToken: (
    token: string
  ) => Effect.Effect<VerifiedApiToken, AuthorizationDenied | CapabilityUnavailable>
}

export class ApiTokenRegistry extends Context.Service<
  ApiTokenRegistry,
  ApiTokenRegistryInterface
>()('@b2b-saas-starter/capabilities/ApiTokenRegistry') {}

/**
 * The full-power bearer token the Seed layer accepts. Documented fixture
 * credential for local development and tests — it carries every scope.
 */
export const SEED_API_TOKEN = 'bsk_seed_0000000000000000'

/**
 * A second fixture token carrying the `read` scope only. It exists so the
 * denial half of the permission matrix is reachable without a live D1: with
 * one all-powerful fixture token, no Seed-backed test could ever observe a
 * 403. Anything other than these two fails with `AuthorizationDenied`,
 * matching the Live layer's behavior for unknown tokens.
 */
export const SEED_READONLY_API_TOKEN = 'bsk_seed_readonly000000'

/**
 * Minimum interval between `lastUsedAt` writes. `verifyBearerToken` runs on
 * every authenticated API request, so bumping the timestamp unconditionally
 * would turn every read into a D1 write. `lastUsedAt` is a coarse
 * "recently active" signal, not an audit trail — once a minute is plenty.
 */
export const LAST_USED_WRITE_INTERVAL_MS = 60_000

/** Pure throttle decision for the `lastUsedAt` bump — exported for tests. */
export function shouldBumpLastUsedAt(lastUsedAt: string | null, now: number): boolean {
  if (!lastUsedAt) {
    return true
  }
  const parsed = Date.parse(lastUsedAt)
  if (Number.isNaN(parsed)) {
    return true
  }
  return now - parsed >= LAST_USED_WRITE_INTERVAL_MS
}

/**
 * Hashing scheme for stored bearer-token hashes. The D1 seed script
 * (`scripts/seed.ts`) shares this export so seeded token rows verify against
 * `verifyBearerToken` — changing the scheme here changes both sides together.
 */
export const hashApiToken = hashSha256
