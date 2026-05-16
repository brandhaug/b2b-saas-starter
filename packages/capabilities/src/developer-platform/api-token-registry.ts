import { Context, Effect, Layer, Schema } from 'effect'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { Database, apiTokenScopes, apiTokens, workspaces } from '@b2b-saas-starter/db'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { AuthorizationDenied } from '../errors.ts'
import { hashSha256, randomHex } from '../internal/crypto.ts'
import { newCapabilityId } from '../internal/ids.ts'
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
  readonly list: Effect.Effect<readonly ApiToken[], never, WorkspaceContext>
  readonly create: (
    input: CreateApiTokenInput
  ) => Effect.Effect<CreatedApiToken, never, WorkspaceContext>
  readonly revoke: (
    input: RevokeApiTokenInput
  ) => Effect.Effect<void, never, WorkspaceContext>
  readonly verifyBearerToken: (
    token: string,
    requiredScope: ApiTokenScope
  ) => Effect.Effect<VerifiedApiToken, AuthorizationDenied>
}

export class ApiTokenRegistry extends Context.Service<
  ApiTokenRegistry,
  ApiTokenRegistryShape
>()('@b2b-saas-starter/capabilities/ApiTokenRegistry') {}

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
    revoke: () => Effect.void,
    verifyBearerToken: (_token, requiredScope) =>
      Effect.succeed({
        id: seed[0]?.id ?? 'tok_seed',
        workspaceId: 'wrk_starter',
        workspaceSlug: 'starter-lab',
        scopes: [requiredScope]
      })
  })

const hashToken = hashSha256

const randomToken = (): string => `bsk_live_${randomHex(24)}`

const tokenPrefix = (token: string): string => token.slice(0, 17)

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
        const rows = yield* Effect.promise(() =>
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
            tokenHash: yield* Effect.promise(() => hashToken(token)),
            scopes: [...input.scopes],
            lastUsedAt: null,
            revokedAt: null,
            createdAt,
            createdByUserId: input.actorUserId ?? null
          }
          yield* Effect.promise(() => db.insert(apiTokens).values(row))
          yield* audit.record({
            workspaceId: ctx.workspace.id,
            actorUserId: input.actorUserId ?? null,
            eventType: 'api_token.created',
            targetType: 'api_token',
            targetId: row.id,
            metadata: { name: input.name, scopes: input.scopes }
          })
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
          yield* Effect.promise(() =>
            db
              .update(apiTokens)
              .set({ revokedAt: new Date().toISOString() })
              .where(
                and(
                  eq(apiTokens.id, input.tokenId),
                  eq(apiTokens.workspaceId, ctx.workspace.id),
                  isNull(apiTokens.revokedAt)
                )
              )
          )
          yield* audit.record({
            workspaceId: ctx.workspace.id,
            actorUserId: input.actorUserId ?? null,
            eventType: 'api_token.revoked',
            targetType: 'api_token',
            targetId: input.tokenId,
            metadata: {}
          })
        }),
      verifyBearerToken: (token, requiredScope) =>
        Effect.gen(function* () {
          const tokenHash = yield* Effect.promise(() => hashToken(token))
          const row = yield* Effect.promise(() =>
            db
              .select({ token: apiTokens, workspace: workspaces })
              .from(apiTokens)
              .innerJoin(workspaces, eq(apiTokens.workspaceId, workspaces.id))
              .where(
                and(eq(apiTokens.tokenHash, tokenHash), isNull(apiTokens.revokedAt))
              )
              .limit(1)
          ).pipe(Effect.map((rows) => rows[0]))
          if (!row || !row.token.scopes.includes(requiredScope)) {
            return yield* Effect.fail(
              new AuthorizationDenied({ reason: 'invalid_or_insufficient_token' })
            )
          }
          yield* Effect.promise(() =>
            db
              .update(apiTokens)
              .set({ lastUsedAt: new Date().toISOString() })
              .where(eq(apiTokens.id, row.token.id))
          )
          yield* audit.record({
            workspaceId: row.workspace.id,
            actorUserId: null,
            eventType: 'api_token.used',
            targetType: 'api_token',
            targetId: row.token.id,
            metadata: { requiredScope }
          })
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
