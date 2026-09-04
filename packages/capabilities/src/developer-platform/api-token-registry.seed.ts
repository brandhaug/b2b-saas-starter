import { DateTime, Effect, Layer } from 'effect'

import { assertWithinPlanLimit } from '../billing/plan-catalog.ts'
import { AuthorizationDenied } from '../errors.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { seedKeysetPage } from '../internal/keyset-cursor.ts'
import { publishWebhookEventWith, WebhookPublisher } from './webhook-publisher.ts'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { seedWorkspaceRecord } from '../seed-fixture.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import {
  API_TOKEN_SCOPES,
  ApiTokenRegistry,
  SEED_API_TOKEN,
  SEED_READONLY_API_TOKEN,
  type ApiToken,
  type ApiTokenScope
} from './api-token-registry.ts'

/**
 * The fixture tokens the Seed layer accepts, and the scopes each one carries.
 * A Map because the lookup key is a bearer token off the wire: an unknown one
 * is the expected case, and `Map#get` reports it as `undefined` without an
 * index signature claiming every string is a fixture token.
 */
const SEED_TOKEN_SCOPES = new Map<string, ReadonlyArray<ApiTokenScope>>([
  [SEED_API_TOKEN, API_TOKEN_SCOPES],
  [SEED_READONLY_API_TOKEN, ['read']]
])

/**
 * A Seed store entry: the fixture projection plus the columns the wire shape
 * hides but the mutation contract needs (owning workspace for scoping, and
 * revocation state so revoke/list agree like Live's `revokedAt` filter).
 */
type SeedTokenEntry = {
  readonly token: ApiToken
  readonly workspaceId: string
  revokedAt: string | null
}

export function SeedApiTokenRegistry(
  seed: ReadonlyArray<ApiToken>
): Layer.Layer<ApiTokenRegistry, never, AuditEventLog | WebhookPublisher> {
  return Layer.effect(ApiTokenRegistry)(
    Effect.gen(function* () {
      const audit = yield* AuditEventLog
      const publisher = yield* WebhookPublisher
      // Mutable store, so Seed mirrors Live's post-conditions: created tokens
      // list back, revoked ones disappear from `list` and cannot be revoked
      // twice, audit events land in the shared fixture log, and the plan gate
      // can actually trip instead of being unreachable.
      const entries: Array<SeedTokenEntry> = seed.map((token) => ({
        token,
        workspaceId: seedWorkspaceRecord.id,
        revokedAt: null
      }))

      function activeIn(workspaceId: string) {
        return entries.filter(
          (entry) => entry.workspaceId === workspaceId && entry.revokedAt === null
        )
      }

      return {
        list: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          return activeIn(ctx.workspace.id)
            .map((entry) => entry.token)
            .toSorted((a, b) => {
              if (a.createdAt > b.createdAt) {
                return -1
              }
              if (a.createdAt < b.createdAt) {
                return 1
              }
              return 0
            })
        }),
        listPage: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            return seedKeysetPage(
              activeIn(ctx.workspace.id).map((entry) => entry.token),
              'desc',
              (token) => ({ key: token.createdAt, id: token.id }),
              input
            )
          }),
        create: Effect.fnUntraced(function* (input) {
          const ctx = yield* WorkspaceContext
          // Same entitlement gate as Live, over the same live count semantics.
          yield* assertWithinPlanLimit({
            resource: 'api_token',
            used: activeIn(ctx.workspace.id).length
          })
          const id = yield* newCapabilityId('tok')
          const createdAt = yield* DateTime.now
          const created: ApiToken = {
            id,
            name: input.name,
            prefix: 'bsk_seed',
            scopes: [...input.scopes],
            lastUsedAt: null,
            createdAt: DateTime.formatIso(createdAt)
          }
          entries.push({
            token: created,
            workspaceId: ctx.workspace.id,
            revokedAt: null
          })
          yield* audit.record({
            workspaceId: ctx.workspace.id,
            actorUserId: ctx.actor?.userId ?? null,
            eventType: 'api_token.created',
            targetType: 'api_token',
            targetId: id,
            metadata: { name: input.name, scopes: input.scopes }
          })
          // The projection, never the minted secret.
          yield* publishWebhookEventWith(publisher, {
            eventType: 'api_token.created',
            payload: created
          })
          return { ...created, token: 'bsk_seed_created_token' }
        }),
        revoke: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const entry = entries.find(
              (candidate) =>
                candidate.token.id === input.tokenId &&
                candidate.workspaceId === ctx.workspace.id &&
                candidate.revokedAt === null
            )
            // No active token in this workspace to revoke — skip both the write
            // and the audit event instead of recording a phantom revocation.
            if (!entry) {
              return false
            }
            entry.revokedAt = DateTime.formatIso(yield* DateTime.now)
            yield* audit.record({
              workspaceId: ctx.workspace.id,
              actorUserId: ctx.actor?.userId ?? null,
              eventType: 'api_token.revoked',
              targetType: 'api_token',
              targetId: input.tokenId,
              metadata: {}
            })
            yield* publishWebhookEventWith(publisher, {
              eventType: 'api_token.revoked',
              payload: { tokenId: input.tokenId }
            })
            return true
          }),
        verifyBearerToken: (token) => {
          // Authentication only: an unknown token is the single failure. Whether
          // the reported scopes cover the request is decided at the route boundary.
          const scopes = SEED_TOKEN_SCOPES.get(token)
          if (!scopes) {
            return Effect.fail(new AuthorizationDenied({ reason: 'invalid_token' }))
          }
          return Effect.succeed({
            id: seed[0]?.id ?? 'tok_seed',
            workspaceId: seedWorkspaceRecord.id,
            workspaceSlug: seedWorkspaceRecord.slug,
            scopes
          })
        }
      }
    })
  )
}
