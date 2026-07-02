import { Context, Effect, Layer, Schema } from 'effect'
import { and, desc, eq, isNull } from 'drizzle-orm'
import {
  apiTokens,
  apiTokenScopes,
  batch,
  Database,
  workspaces
} from '@b2b-saas-starter/db'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { AuthorizationDenied, type CapabilityUnavailable } from '../errors.ts'
import { hashSha256, randomHex } from '../internal/crypto.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { WorkspaceContext } from '../workspace-context.ts'

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
  readonly scopes: readonly ApiTokenScope[]
}

export type CreateApiTokenInput = {
  readonly name: string
  readonly scopes: readonly ApiTokenScope[]
  readonly actorUserId?: string
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
  readonly actorUserId?: string
}

export type ApiTokenRegistryShape = {
  readonly list: Effect.Effect<
    readonly ApiToken[],
    CapabilityUnavailable,
    WorkspaceContext
  >
  readonly create: (
    input: CreateApiTokenInput
  ) => Effect.Effect<CreatedApiToken, CapabilityUnavailable, WorkspaceContext>
  /** Resolves `true` when a token was revoked, `false` when nothing matched. */
  readonly revoke: (
    input: RevokeApiTokenInput
  ) => Effect.Effect<boolean, CapabilityUnavailable, WorkspaceContext>
  readonly verifyBearerToken: (
    token: string,
    requiredScope: ApiTokenScope
  ) => Effect.Effect<VerifiedApiToken, AuthorizationDenied | CapabilityUnavailable>
}

export class ApiTokenRegistry extends Context.Service<
  ApiTokenRegistry,
  ApiTokenRegistryShape
>()('@b2b-saas-starter/capabilities/ApiTokenRegistry') {}

/**
 * The only bearer token the Seed layer accepts. Documented fixture credential
 * for local development and tests — everything else fails with
 * `AuthorizationDenied`, matching the Live layer's behavior for unknown tokens.
 */
export const SEED_API_TOKEN = 'bsk_seed_0000000000000000'

/**
 * Minimum interval between `lastUsedAt` writes. `verifyBearerToken` runs on
 * every authenticated API request, so bumping the timestamp unconditionally
 * would turn every read into a D1 write. `lastUsedAt` is a coarse
 * "recently active" signal, not an audit trail — once a minute is plenty.
 */
export const LAST_USED_WRITE_INTERVAL_MS = 60_000

/** Pure throttle decision for the `lastUsedAt` bump — exported for tests. */
export const shouldBumpLastUsedAt = (
  lastUsedAt: string | null,
  now: number
): boolean => {
  if (!lastUsedAt) return true
  const parsed = Date.parse(lastUsedAt)
  return Number.isNaN(parsed) || now - parsed >= LAST_USED_WRITE_INTERVAL_MS
}

export const SeedApiTokenRegistry = (
  seed: readonly ApiToken[]
): Layer.Layer<ApiTokenRegistry> =>
  Layer.succeed(ApiTokenRegistry)({
    list: Effect.succeed(seed),
    create: (input) =>
      Effect.succeed({
        id: `tok_${Date.now()}`,
        name: input.name,
        prefix: 'bsk_seed',
        scopes: [...input.scopes],
        lastUsedAt: null,
        createdAt: new Date().toISOString(),
        token: 'bsk_seed_created_token'
      }),
    revoke: () => Effect.succeed(true),
    verifyBearerToken: (token, _requiredScope) =>
      // The seed token carries all scopes, so `insufficient_scope` is
      // unreachable here — every failure is an unknown token.
      token === SEED_API_TOKEN
        ? Effect.succeed({
            id: seed[0]?.id ?? 'tok_seed',
            workspaceId: 'wrk_starter',
            workspaceSlug: 'starter-lab',
            scopes: API_TOKEN_SCOPES
          })
        : Effect.fail(new AuthorizationDenied({ reason: 'invalid_token' }))
  })

/**
 * Hashing scheme for stored bearer-token hashes. The D1 seed script
 * (`scripts/seed.ts`) shares this export so seeded token rows verify against
 * `verifyBearerToken` — changing the scheme here changes both sides together.
 */
export const hashApiToken = hashSha256

const randomToken = (): string => `bsk_live_${randomHex(24)}`

const tokenPrefix = (token: string): string => token.slice(0, 17)

const unavailable = orUnavailable('api-token-registry')

export const LiveApiTokenRegistry: Layer.Layer<
  ApiTokenRegistry,
  never,
  Database | AuditEventLog
> = Layer.effect(ApiTokenRegistry)(
  Effect.gen(function* () {
    const db = yield* Database
    const audit = yield* AuditEventLog

    return {
      list: Effect.gen(function* () {
        const ctx = yield* WorkspaceContext
        const rows = yield* unavailable(
          db
            .select()
            .from(apiTokens)
            .where(
              and(
                eq(apiTokens.workspaceId, ctx.workspace.id),
                isNull(apiTokens.revokedAt)
              )
            )
            .orderBy(desc(apiTokens.createdAt))
        )
        return rows.map((row) => ({
          id: row.id,
          name: row.name,
          prefix: row.tokenPrefix,
          scopes: row.scopes,
          lastUsedAt: row.lastUsedAt,
          createdAt: row.createdAt
        }))
      }),
      create: (input) =>
        Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const token = randomToken()
          const createdAt = new Date().toISOString()
          const row = {
            id: newCapabilityId('tok'),
            workspaceId: ctx.workspace.id,
            name: input.name,
            tokenPrefix: tokenPrefix(token),
            tokenHash: yield* Effect.promise(() => hashApiToken(token)),
            scopes: [...input.scopes],
            lastUsedAt: null,
            revokedAt: null,
            createdAt,
            createdByUserId: input.actorUserId ?? null
          }
          yield* unavailable(
            batch(db, [
              db.insert(apiTokens).values(row),
              audit.prepareRecord({
                workspaceId: ctx.workspace.id,
                actorUserId: input.actorUserId ?? null,
                eventType: 'api_token.created',
                targetType: 'api_token',
                targetId: row.id,
                metadata: { name: input.name, scopes: input.scopes }
              })
            ])
          )
          return {
            id: row.id,
            name: row.name,
            prefix: row.tokenPrefix,
            scopes: row.scopes,
            lastUsedAt: null,
            createdAt,
            token
          }
        }),
      revoke: (input) =>
        Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const matched = yield* unavailable(
            db
              .select({ id: apiTokens.id })
              .from(apiTokens)
              .where(
                and(
                  eq(apiTokens.id, input.tokenId),
                  eq(apiTokens.workspaceId, ctx.workspace.id),
                  isNull(apiTokens.revokedAt)
                )
              )
              .limit(1)
          )
          // No row in this workspace to revoke — skip both the update and the
          // audit event instead of recording a phantom revocation.
          if (matched.length === 0) return false
          yield* unavailable(
            batch(db, [
              db
                .update(apiTokens)
                .set({ revokedAt: new Date().toISOString() })
                .where(
                  and(
                    eq(apiTokens.id, input.tokenId),
                    eq(apiTokens.workspaceId, ctx.workspace.id),
                    isNull(apiTokens.revokedAt)
                  )
                ),
              audit.prepareRecord({
                workspaceId: ctx.workspace.id,
                actorUserId: input.actorUserId ?? null,
                eventType: 'api_token.revoked',
                targetType: 'api_token',
                targetId: input.tokenId,
                metadata: {}
              })
            ])
          )
          return true
        }),
      verifyBearerToken: (token, requiredScope) =>
        Effect.gen(function* () {
          const tokenHash = yield* Effect.promise(() => hashApiToken(token))
          const row = yield* unavailable(
            db
              .select({ token: apiTokens, workspace: workspaces })
              .from(apiTokens)
              .innerJoin(workspaces, eq(apiTokens.workspaceId, workspaces.id))
              .where(
                and(eq(apiTokens.tokenHash, tokenHash), isNull(apiTokens.revokedAt))
              )
              .limit(1)
          ).pipe(Effect.map((rows) => rows[0]))
          // Unknown/revoked token and known-token-without-scope fail with
          // distinct reasons so the API worker can answer 401 vs 403.
          if (!row) {
            return yield* Effect.fail(
              new AuthorizationDenied({ reason: 'invalid_token' })
            )
          }
          if (!row.token.scopes.includes(requiredScope)) {
            return yield* Effect.fail(
              new AuthorizationDenied({ reason: 'insufficient_scope' })
            )
          }
          // Bump `lastUsedAt` at most once per LAST_USED_WRITE_INTERVAL_MS.
          // The per-request `api_token.used` audit event was removed: it did a
          // second D1 write per request and flooded the governance log.
          if (shouldBumpLastUsedAt(row.token.lastUsedAt, Date.now())) {
            yield* unavailable(
              db
                .update(apiTokens)
                .set({ lastUsedAt: new Date().toISOString() })
                .where(eq(apiTokens.id, row.token.id))
            )
          }
          return {
            id: row.token.id,
            workspaceId: row.workspace.id,
            workspaceSlug: row.workspace.slug,
            scopes: row.token.scopes
          }
        })
    }
  })
)
