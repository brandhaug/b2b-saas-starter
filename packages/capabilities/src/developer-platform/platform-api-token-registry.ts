import { Context, Effect, Layer, Schema } from 'effect'
import { and, desc, eq, isNull } from 'drizzle-orm'
import {
  batch,
  batchQueries,
  Database,
  merchants,
  platformApiTokens,
  platformApiTokenScopes
} from '@b2b-saas-starter/db'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { type CapabilityUnavailable } from '../errors.ts'
import { hashSha256, randomHex } from '../internal/crypto.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { orUnavailable } from '../internal/unavailable.ts'

export const PLATFORM_API_TOKEN_SCOPES = platformApiTokenScopes
export const PlatformApiTokenScope = Schema.Literals(PLATFORM_API_TOKEN_SCOPES)
export type PlatformApiTokenScope = typeof PlatformApiTokenScope.Type
export const PlatformApiTokenStatus = Schema.Literals(['active', 'expired', 'revoked'])
export type PlatformApiTokenStatus = typeof PlatformApiTokenStatus.Type

export const PlatformApiToken = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  prefix: Schema.String,
  scopes: Schema.Array(PlatformApiTokenScope),
  status: PlatformApiTokenStatus,
  lastUsedAt: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(Schema.String),
  revokedAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  createdByUserId: Schema.NullOr(Schema.String)
})
export type PlatformApiToken = typeof PlatformApiToken.Type
export type CreatedPlatformApiToken = PlatformApiToken & { readonly token: string }

export class PlatformApiTokenDenied extends Schema.TaggedErrorClass<PlatformApiTokenDenied>()(
  'PlatformApiTokenDenied',
  {
    reason: Schema.Literals([
      'unauthorized',
      'insufficient_scope',
      'scope_escalation_denied',
      'invalid_input'
    ]),
    requiredScope: Schema.optional(PlatformApiTokenScope)
  }
) {}

export type VerifiedPlatformApiToken = {
  readonly id: string
  readonly merchantId: string
  readonly merchantSlug: string
  readonly scopes: readonly PlatformApiTokenScope[]
}
export type PlatformApiTokenPage = {
  readonly data: readonly PlatformApiToken[]
  readonly page: { readonly nextCursor: string | null }
}
export type CreatePlatformApiTokenInput = {
  readonly merchantId: string
  readonly name: string
  readonly scopes: readonly PlatformApiTokenScope[]
  readonly expiresAt: string | null
  readonly actorUserId?: string
  readonly delegatedBy?: VerifiedPlatformApiToken
}
export type FreshPasswordAuthenticationProof = {
  readonly userId: string
  readonly verifiedAt: string
  readonly method: 'password'
}

export type PlatformApiTokenRegistryShape = {
  readonly bootstrap: (input: {
    readonly merchantId: string
    readonly name: string
    readonly scopes: readonly PlatformApiTokenScope[]
    readonly expiresAt: string | null
    readonly proof: FreshPasswordAuthenticationProof
  }) => Effect.Effect<
    CreatedPlatformApiToken,
    PlatformApiTokenDenied | CapabilityUnavailable
  >
  readonly list: (input: {
    readonly merchantId: string
    readonly statuses?: readonly PlatformApiTokenStatus[]
    readonly cursor?: string
    readonly limit?: number
  }) => Effect.Effect<
    PlatformApiTokenPage,
    PlatformApiTokenDenied | CapabilityUnavailable
  >
  readonly create: (
    input: CreatePlatformApiTokenInput
  ) => Effect.Effect<
    CreatedPlatformApiToken,
    PlatformApiTokenDenied | CapabilityUnavailable
  >
  readonly revoke: (input: {
    readonly merchantId: string
    readonly tokenId: string
    readonly actorTokenId?: string
    readonly actorUserId?: string
  }) => Effect.Effect<void, CapabilityUnavailable>
  readonly verify: (
    credential: string,
    requiredScope: PlatformApiTokenScope
  ) => Effect.Effect<
    VerifiedPlatformApiToken,
    PlatformApiTokenDenied | CapabilityUnavailable
  >
}

export class PlatformApiTokenRegistry extends Context.Service<
  PlatformApiTokenRegistry,
  PlatformApiTokenRegistryShape
>()('@b2b-saas-starter/capabilities/PlatformApiTokenRegistry') {}

export const SEED_PLATFORM_API_TOKEN = 'bpk_seed_platform_api_token'

export const SeedPlatformApiTokenRegistry =
  (): Layer.Layer<PlatformApiTokenRegistry> => {
    let tokens: Array<CreatedPlatformApiToken & { readonly merchantId: string }> = [
      {
        id: 'pat_seed_platform',
        merchantId: 'mer_seed_booking_studio',
        name: 'Seed integration',
        prefix: 'bpk_seed_platform',
        scopes: [...PLATFORM_API_TOKEN_SCOPES],
        status: 'active',
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
        createdAt: '2026-07-10T09:30:00.000Z',
        createdByUserId: null,
        token: SEED_PLATFORM_API_TOKEN
      }
    ]
    const service: PlatformApiTokenRegistryShape = {
      bootstrap: (input) =>
        tokens.some((token) => token.merchantId === input.merchantId) ||
        Date.now() - Date.parse(input.proof.verifiedAt) > 15 * 60_000
          ? Effect.fail(new PlatformApiTokenDenied({ reason: 'unauthorized' }))
          : service.create({
              merchantId: input.merchantId,
              name: input.name,
              scopes: input.scopes,
              expiresAt: input.expiresAt,
              actorUserId: input.proof.userId
            }),
      list: (input) => {
        const visible = tokens
          .filter((token) => token.merchantId === input.merchantId)
          .map(({ token: _secret, merchantId: _merchantId, ...token }) => ({
            ...token,
            status: platformApiTokenStatus(token)
          }))
          .filter((token) => !input.statuses || input.statuses.includes(token.status))
        return Effect.succeed({
          data: visible.slice(0, input.limit ?? 50),
          page: { nextCursor: null }
        })
      },
      create: (input) =>
        validateCreate(input).pipe(
          Effect.map(() => {
            const createdAt = new Date().toISOString()
            const created = {
              id: newCapabilityId('pat'),
              merchantId: input.merchantId,
              name: input.name.trim(),
              prefix: 'bpk_seed_created',
              scopes: [...input.scopes],
              status: 'active' as const,
              lastUsedAt: null,
              expiresAt: input.expiresAt,
              revokedAt: null,
              createdAt,
              createdByUserId: input.actorUserId ?? null,
              token: 'bpk_seed_created_token'
            }
            tokens.push(created)
            return created
          })
        ),
      revoke: (input) =>
        Effect.sync(() => {
          tokens = tokens.map((token) =>
            token.id === input.tokenId &&
            token.merchantId === input.merchantId &&
            token.revokedAt === null
              ? { ...token, revokedAt: new Date().toISOString(), status: 'revoked' }
              : token
          )
        }),
      verify: (credential, requiredScope) => {
        const token = tokens.find(
          (candidate) =>
            candidate.token === credential &&
            platformApiTokenStatus(candidate) === 'active'
        )
        if (!token) {
          return Effect.fail(new PlatformApiTokenDenied({ reason: 'unauthorized' }))
        }
        if (!token.scopes.includes(requiredScope)) {
          return Effect.fail(
            new PlatformApiTokenDenied({ reason: 'insufficient_scope', requiredScope })
          )
        }
        return Effect.succeed({
          id: token.id,
          merchantId: token.merchantId,
          merchantSlug: token.merchantId,
          scopes: token.scopes
        })
      }
    }
    return Layer.succeed(PlatformApiTokenRegistry)(service)
  }

export const platformApiTokenStatus = (
  token: Pick<PlatformApiToken, 'revokedAt' | 'expiresAt'>,
  now = Date.now()
): PlatformApiTokenStatus =>
  token.revokedAt !== null
    ? 'revoked'
    : token.expiresAt !== null && Date.parse(token.expiresAt) <= now
      ? 'expired'
      : 'active'

const validateCreate = (
  input: CreatePlatformApiTokenInput
): Effect.Effect<void, PlatformApiTokenDenied> => {
  const name = input.name.trim()
  const scopes = new Set(input.scopes)
  const validExpiration =
    input.expiresAt === null ||
    (!Number.isNaN(Date.parse(input.expiresAt)) &&
      Date.parse(input.expiresAt) > Date.now())
  if (
    name.length < 1 ||
    name.length > 100 ||
    scopes.size !== input.scopes.length ||
    scopes.size < 1 ||
    scopes.size > PLATFORM_API_TOKEN_SCOPES.length ||
    !validExpiration
  ) {
    return Effect.fail(new PlatformApiTokenDenied({ reason: 'invalid_input' }))
  }
  if (input.delegatedBy) {
    if (
      input.delegatedBy.merchantId !== input.merchantId ||
      input.scopes.some((scope) => !input.delegatedBy!.scopes.includes(scope))
    ) {
      return Effect.fail(
        new PlatformApiTokenDenied({ reason: 'scope_escalation_denied' })
      )
    }
  }
  return Effect.void
}

const encodeCursor = (token: PlatformApiToken): string =>
  btoa(`${token.createdAt}\n${token.id}`)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
const decodeCursor = (cursor: string): readonly [string, string] | null => {
  try {
    const decoded = atob(cursor.replaceAll('-', '+').replaceAll('_', '/'))
    const [createdAt, id, ...rest] = decoded.split('\n')
    return createdAt && id && rest.length === 0 ? [createdAt, id] : null
  } catch {
    return null
  }
}
const toDto = (row: typeof platformApiTokens.$inferSelect): PlatformApiToken => ({
  id: row.id,
  name: row.name,
  prefix: row.tokenPrefix,
  scopes: row.scopes,
  status: platformApiTokenStatus(row),
  lastUsedAt: row.lastUsedAt,
  expiresAt: row.expiresAt,
  revokedAt: row.revokedAt,
  createdAt: row.createdAt,
  createdByUserId: row.createdByUserId
})

const randomToken = (): string => `bpk_live_${randomHex(32)}`
const unavailable = orUnavailable('platform-api-token-registry')

export const LivePlatformApiTokenRegistry: Layer.Layer<
  PlatformApiTokenRegistry,
  never,
  Database | AuditEventLog
> = Layer.effect(
  PlatformApiTokenRegistry,
  Effect.gen(function* () {
    const db = yield* Database
    const audit = yield* AuditEventLog
    const createToken = (input: CreatePlatformApiTokenInput) =>
      Effect.gen(function* () {
        yield* validateCreate(input)
        const name = input.name.trim()
        const token = randomToken()
        const createdAt = new Date().toISOString()
        const row = {
          id: newCapabilityId('pat'),
          merchantId: input.merchantId,
          name,
          tokenPrefix: token.slice(0, 18),
          tokenHash: yield* Effect.promise(() => hashSha256(token)),
          scopes: [...input.scopes],
          lastUsedAt: null,
          expiresAt: input.expiresAt,
          revokedAt: null,
          createdAt,
          createdByUserId: input.actorUserId ?? null
        }
        yield* unavailable(
          batch(db, [
            db.insert(platformApiTokens).values(row),
            audit.prepareRecord({
              actorUserId: input.actorUserId ?? null,
              eventType: 'platform_api_token.created',
              targetType: 'platform_api_token',
              targetId: row.id,
              metadata: {
                merchantId: input.merchantId,
                name: row.name,
                scopes: row.scopes,
                delegatedByTokenId: input.delegatedBy?.id ?? null
              }
            })
          ])
        )
        return { ...toDto(row), token }
      })
    return {
      bootstrap: (input) =>
        Effect.gen(function* () {
          const verifiedAt = Date.parse(input.proof.verifiedAt)
          if (
            Number.isNaN(verifiedAt) ||
            verifiedAt > Date.now() ||
            Date.now() - verifiedAt > 15 * 60_000
          ) {
            return yield* Effect.fail(
              new PlatformApiTokenDenied({ reason: 'unauthorized' })
            )
          }
          const existing = yield* unavailable(
            db
              .select({ id: platformApiTokens.id })
              .from(platformApiTokens)
              .where(eq(platformApiTokens.merchantId, input.merchantId))
              .limit(1)
          )
          if (existing.length > 0) {
            return yield* Effect.fail(
              new PlatformApiTokenDenied({ reason: 'unauthorized' })
            )
          }
          return yield* createToken({
            merchantId: input.merchantId,
            name: input.name,
            scopes: input.scopes,
            expiresAt: input.expiresAt,
            actorUserId: input.proof.userId
          })
        }),
      list: (input) =>
        Effect.gen(function* () {
          const limit = input.limit ?? 50
          if (
            limit < 1 ||
            limit > 100 ||
            (input.cursor && !decodeCursor(input.cursor))
          ) {
            return yield* Effect.fail(
              new PlatformApiTokenDenied({ reason: 'invalid_input' })
            )
          }
          const rows = yield* unavailable(
            db
              .select()
              .from(platformApiTokens)
              .where(eq(platformApiTokens.merchantId, input.merchantId))
              .orderBy(desc(platformApiTokens.createdAt), desc(platformApiTokens.id))
          )
          const cursor = input.cursor ? decodeCursor(input.cursor) : null
          const visible = rows
            .map(toDto)
            .filter((token) => !input.statuses || input.statuses.includes(token.status))
            .filter(
              (token) =>
                !cursor ||
                token.createdAt < cursor[0] ||
                (token.createdAt === cursor[0] && token.id < cursor[1])
            )
          const data = visible.slice(0, limit)
          return {
            data,
            page: {
              nextCursor: visible.length > limit ? encodeCursor(data.at(-1)!) : null
            }
          }
        }),
      create: createToken,
      revoke: (input) =>
        Effect.gen(function* () {
          const revokedAt = new Date().toISOString()
          const update = db
            .update(platformApiTokens)
            .set({ revokedAt })
            .where(
              and(
                eq(platformApiTokens.id, input.tokenId),
                eq(platformApiTokens.merchantId, input.merchantId),
                isNull(platformApiTokens.revokedAt)
              )
            )
            .toSQL()
          const auditInsert = audit
            .prepareRecord({
              actorUserId: input.actorUserId ?? null,
              eventType: 'platform_api_token.revoked',
              targetType: 'platform_api_token',
              targetId: input.tokenId,
              metadata: {
                merchantId: input.merchantId,
                actorTokenId: input.actorTokenId ?? null
              }
            })
            .toSQL()
          const conditionalAuditSql = auditInsert.sql.replace(
            / values \((.*)\)$/,
            ' select $1 where changes() > 0'
          )
          yield* unavailable(
            batchQueries(db, [
              update,
              { sql: conditionalAuditSql, params: auditInsert.params }
            ])
          )
        }),
      verify: (credential, requiredScope) =>
        Effect.gen(function* () {
          if (!credential.startsWith('bpk_live_')) {
            return yield* Effect.fail(
              new PlatformApiTokenDenied({ reason: 'unauthorized' })
            )
          }
          const tokenHash = yield* Effect.promise(() => hashSha256(credential))
          const found = yield* unavailable(
            db
              .select({ token: platformApiTokens, merchant: merchants })
              .from(platformApiTokens)
              .innerJoin(merchants, eq(platformApiTokens.merchantId, merchants.id))
              .where(eq(platformApiTokens.tokenHash, tokenHash))
              .limit(1)
          ).pipe(Effect.map((rows) => rows[0]))
          if (!found || platformApiTokenStatus(found.token) !== 'active') {
            return yield* Effect.fail(
              new PlatformApiTokenDenied({ reason: 'unauthorized' })
            )
          }
          if (!found.token.scopes.includes(requiredScope)) {
            return yield* Effect.fail(
              new PlatformApiTokenDenied({
                reason: 'insufficient_scope',
                requiredScope
              })
            )
          }
          return {
            id: found.token.id,
            merchantId: found.merchant.id,
            merchantSlug: found.merchant.slug,
            scopes: found.token.scopes
          }
        })
    }
  })
)
