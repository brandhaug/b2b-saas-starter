import {
  apiTokens,
  apiTokenScopes,
  workspaces
} from '@b2b-saas-starter/db/src/schema.ts'
import { batch, Database } from '@b2b-saas-starter/db/src/service.ts'
import { Context, DateTime, Effect, Layer, Schema } from 'effect'
import { and, desc, eq, isNull } from 'drizzle-orm'

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

export type ApiTokenRegistryInterface = {
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
  if (!lastUsedAt) return true
  const parsed = Date.parse(lastUsedAt)
  if (Number.isNaN(parsed)) return true
  return now - parsed >= LAST_USED_WRITE_INTERVAL_MS
}

/**
 * The fixture tokens the Seed layer accepts, and the scopes each one carries.
 * A Map because the lookup key is a bearer token off the wire: an unknown one
 * is the expected case, and `Map#get` reports it as `undefined` without an
 * index signature claiming every string is a fixture token.
 */
const SEED_TOKEN_SCOPES = new Map<string, readonly ApiTokenScope[]>([
  [SEED_API_TOKEN, API_TOKEN_SCOPES],
  [SEED_READONLY_API_TOKEN, ['read']]
])

export function SeedApiTokenRegistry(
  seed: readonly ApiToken[]
): Layer.Layer<ApiTokenRegistry> {
  return Layer.succeed(ApiTokenRegistry)({
    list: Effect.succeed(seed),
    create: Effect.fnUntraced(function* (input) {
      const id = yield* newCapabilityId('tok')
      const createdAt = yield* DateTime.now
      return {
        id,
        name: input.name,
        prefix: 'bsk_seed',
        scopes: [...input.scopes],
        lastUsedAt: null,
        createdAt: DateTime.formatIso(createdAt),
        token: 'bsk_seed_created_token'
      }
    }),
    revoke: () => Effect.succeed(true),
    verifyBearerToken: (token) => {
      // Authentication only: an unknown token is the single failure. Whether
      // the reported scopes cover the request is decided at the route boundary.
      const scopes = SEED_TOKEN_SCOPES.get(token)
      if (!scopes) {
        return Effect.fail(new AuthorizationDenied({ reason: 'invalid_token' }))
      }
      return Effect.succeed({
        id: seed[0]?.id ?? 'tok_seed',
        workspaceId: 'wrk_starter',
        workspaceSlug: 'starter-lab',
        scopes
      })
    }
  })
}

/**
 * Hashing scheme for stored bearer-token hashes. The D1 seed script
 * (`scripts/seed.ts`) shares this export so seeded token rows verify against
 * `verifyBearerToken` — changing the scheme here changes both sides together.
 */
export const hashApiToken = hashSha256

function randomToken(): string {
  return `bsk_live_${randomHex(24)}`
}

function tokenPrefix(token: string): string {
  return token.slice(0, 17)
}

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
          const createdAt = DateTime.formatIso(yield* DateTime.now)
          const row = {
            id: yield* newCapabilityId('tok'),
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
          const auditCreated = yield* audit.prepareRecord({
            workspaceId: ctx.workspace.id,
            actorUserId: input.actorUserId ?? null,
            eventType: 'api_token.created',
            targetType: 'api_token',
            targetId: row.id,
            metadata: { name: input.name, scopes: input.scopes }
          })
          yield* unavailable(
            batch(db, [db.insert(apiTokens).values(row), auditCreated])
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
          const revokedAt = yield* DateTime.now
          const auditRevoked = yield* audit.prepareRecord({
            workspaceId: ctx.workspace.id,
            actorUserId: input.actorUserId ?? null,
            eventType: 'api_token.revoked',
            targetType: 'api_token',
            targetId: input.tokenId,
            metadata: {}
          })
          yield* unavailable(
            batch(db, [
              db
                .update(apiTokens)
                .set({ revokedAt: DateTime.formatIso(revokedAt) })
                .where(
                  and(
                    eq(apiTokens.id, input.tokenId),
                    eq(apiTokens.workspaceId, ctx.workspace.id),
                    isNull(apiTokens.revokedAt)
                  )
                ),
              auditRevoked
            ])
          )
          return true
        }),
      verifyBearerToken: (token) =>
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
          // An unknown or revoked token is the only failure here, and the API
          // worker answers it 401. A known token that may not do what it asked
          // is a separate 403 raised by `requirePermission` at the boundary.
          if (!row) {
            return yield* Effect.fail(
              new AuthorizationDenied({ reason: 'invalid_token' })
            )
          }
          // Bump `lastUsedAt` at most once per LAST_USED_WRITE_INTERVAL_MS.
          // The per-request `api_token.used` audit event was removed: it did a
          // second D1 write per request and flooded the governance log.
          const usedAt = yield* DateTime.now
          if (
            shouldBumpLastUsedAt(row.token.lastUsedAt, DateTime.toEpochMillis(usedAt))
          ) {
            yield* unavailable(
              db
                .update(apiTokens)
                .set({ lastUsedAt: DateTime.formatIso(usedAt) })
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
