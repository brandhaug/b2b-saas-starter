import {
  SeedResourceInventory,
  SeedResourceInventoryLayer
} from '@b2b-saas-starter/billing/resource-inventory.seed'
import { WorkspaceContext as BillingWorkspaceContext } from '@b2b-saas-starter/billing/ports'
import { Billing } from '@b2b-saas-starter/billing/billing'
import { DateTime, Effect, Layer } from 'effect'

import { assertWithinPlanLimit } from '@b2b-saas-starter/billing/resource-admission'
import { ResourceEntitlements } from '@b2b-saas-starter/billing/resource-entitlements'
import { ApiTokenNotRotatable, AuthorizationDenied } from '../errors.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { seedKeysetPage } from '../internal/keyset-cursor.ts'
import { publishWebhookEventWith, WebhookPublisher } from './webhook-publisher.ts'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { seedApiTokenValue, seedWorkspaceRecord } from '../seed-fixture.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import {
  mintApiToken,
  planTokenReplacement,
  tokenIsExpired,
  validateTokenCreation
} from './api-token-policy.ts'
import {
  ApiTokenRegistry,
  hashApiToken,
  shouldBumpLastUsedAt,
  type ApiToken
} from './api-token-registry.ts'

type SeedTokenEntry = {
  token: ApiToken
  readonly tokenHash: string
  readonly workspaceId: string
  readonly workspaceSlug: string
  revokedAt: string | null
}

export function SeedApiTokenRegistry(
  seed: ReadonlyArray<ApiToken>
): Layer.Layer<
  ApiTokenRegistry,
  never,
  Billing | AuditEventLog | WebhookPublisher | ResourceEntitlements
> {
  return Layer.effect(
    ApiTokenRegistry,
    Effect.gen(function* () {
      const billing = yield* Billing
      const audit = yield* AuditEventLog
      const publisher = yield* WebhookPublisher
      const entitlements = yield* ResourceEntitlements
      const inventory = yield* SeedResourceInventory
      const lock = inventory.lock
      const mutation = lock.withPermits(1)
      const entries = yield* Effect.forEach(seed, (token) =>
        Effect.gen(function* () {
          const plaintext = seedApiTokenValue(token)
          return {
            token,
            tokenHash: yield* Effect.promise(() => hashApiToken(plaintext)),
            workspaceId: seedWorkspaceRecord.id,
            workspaceSlug: seedWorkspaceRecord.slug,
            revokedAt: null
          } satisfies SeedTokenEntry
        })
      )
      // Mutable entries have the same hash-only storage and lifecycle as D1.
      const store: Array<SeedTokenEntry> = entries
      function activeIn(workspaceId: string) {
        return store.filter(
          (entry) => entry.workspaceId === workspaceId && entry.revokedAt === null
        )
      }
      inventory.registerTokenResolver((workspaceId, id) => {
        const seen = new Set<string>()
        let current = id
        while (!seen.has(current)) {
          seen.add(current)
          const currentId = current
          const row = store.find(
            (entry) => entry.workspaceId === workspaceId && entry.token.id === currentId
          )
          if (!row || row.token.replacedByTokenId === null) {
            return current
          }
          current = row.token.replacedByTokenId
        }
        return current
      })
      inventory.registerTokens((workspaceId, now, includeUnavailable) => {
        const ids: Array<string> = []
        for (const entry of store) {
          if (
            entry.workspaceId === workspaceId &&
            (includeUnavailable ||
              (entry.revokedAt === null &&
                entry.token.replacedByTokenId === null &&
                !tokenIsExpired(entry.token.expiresAt, now)))
          ) {
            ids.push(entry.token.id)
          }
        }
        return ids
      })
      return ApiTokenRegistry.of({
        list: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          return activeIn(ctx.workspace.id)
            .map((entry) => entry.token)
            .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
        }),
        listPage: Effect.fn('ApiTokenRegistry.listPage')(function* (input) {
          const ctx = yield* WorkspaceContext
          return seedKeysetPage(
            activeIn(ctx.workspace.id).map((entry) => entry.token),
            'desc',
            (token) => ({ key: token.createdAt, id: token.id }),
            input
          )
        }),
        create: Effect.fn('ApiTokenRegistry.create')(function* (input) {
          const ctx = yield* WorkspaceContext
          const now = yield* DateTime.now
          const valid = yield* validateTokenCreation(input, DateTime.toEpochMillis(now))
          yield* assertWithinPlanLimit({
            resource: 'api_token',
            used: activeIn(ctx.workspace.id).filter(
              (entry) =>
                entry.token.replacedByTokenId === null &&
                !tokenIsExpired(entry.token.expiresAt, DateTime.toEpochMillis(now))
            ).length
          }).pipe(
            Effect.provideService(Billing, billing),
            Effect.provideService(BillingWorkspaceContext, ctx)
          )
          const token = mintApiToken()
          const created: ApiToken = {
            id: yield* newCapabilityId('tok'),
            name: valid.name,
            prefix: token.slice(0, 17),
            scopes: valid.scopes,
            lastUsedAt: null,
            createdAt: DateTime.formatIso(now),
            expiresAt: valid.expiresAt ?? null,
            replacedByTokenId: null
          }
          const tokenHash = yield* Effect.promise(() => hashApiToken(token))
          yield* audit.record({
            workspaceId: ctx.workspace.id,
            actorUserId: ctx.actor?.userId ?? null,
            actorType: ctx.actorType,
            eventType: 'api_token.created',
            targetType: 'api_token',
            targetId: created.id,
            metadata: {
              name: created.name,
              scopes: created.scopes,
              expiresAt: created.expiresAt
            }
          })
          store.push({
            token: created,
            tokenHash,
            workspaceId: ctx.workspace.id,
            workspaceSlug: ctx.workspace.slug,
            revokedAt: null
          })
          yield* publishWebhookEventWith(publisher, {
            eventType: 'api_token.created',
            payload: created
          })
          return { ...created, token }
        }, mutation),
        replace: Effect.fn('ApiTokenRegistry.replace')(function* (input) {
          const ctx = yield* WorkspaceContext
          const entry = activeIn(ctx.workspace.id).find(
            (candidate) => candidate.token.id === input.tokenId
          )
          if (!entry) {
            return yield* Effect.fail(
              new ApiTokenNotRotatable({ tokenId: input.tokenId })
            )
          }
          const now = yield* DateTime.now
          const plan = yield* planTokenReplacement(
            entry.token,
            input,
            DateTime.toEpochMillis(now)
          )
          const token = mintApiToken()
          const created: ApiToken = {
            id: yield* newCapabilityId('tok'),
            name: entry.token.name,
            prefix: token.slice(0, 17),
            scopes: plan.scopes,
            expiresAt: plan.expiresAt,
            lastUsedAt: null,
            createdAt: DateTime.formatIso(now),
            replacedByTokenId: null
          }
          const tokenHash = yield* Effect.promise(() => hashApiToken(token))
          yield* audit.record({
            workspaceId: ctx.workspace.id,
            actorUserId: ctx.actor?.userId ?? null,
            actorType: ctx.actorType,
            eventType: 'api_token.replaced',
            targetType: 'api_token',
            targetId: created.id,
            metadata: {
              previousTokenId: entry.token.id,
              replacementTokenId: created.id,
              previousTokenExpiresAt: plan.previousTokenExpiresAt,
              expiresAt: created.expiresAt,
              scopes: created.scopes
            }
          })
          entry.token = {
            ...entry.token,
            expiresAt: plan.previousTokenExpiresAt,
            replacedByTokenId: created.id
          }
          store.push({
            token: created,
            tokenHash,
            workspaceId: ctx.workspace.id,
            workspaceSlug: ctx.workspace.slug,
            revokedAt: null
          })
          inventory.rotateToken(ctx.workspace.id, input.tokenId, created.id)
          // Replacement is a credential creation; the existing webhook vocabulary stays stable.
          yield* publishWebhookEventWith(publisher, {
            eventType: 'api_token.created',
            payload: created
          })
          return {
            ...created,
            token,
            previousTokenId: input.tokenId,
            previousTokenExpiresAt: plan.previousTokenExpiresAt
          }
        }, mutation),
        revoke: Effect.fn('ApiTokenRegistry.revoke')(function* (input) {
          const ctx = yield* WorkspaceContext
          const entry = activeIn(ctx.workspace.id).find(
            (candidate) => candidate.token.id === input.tokenId
          )
          if (!entry) {
            return false
          }
          const revokedAt = DateTime.formatIso(yield* DateTime.now)
          yield* audit.record({
            workspaceId: ctx.workspace.id,
            actorUserId: ctx.actor?.userId ?? null,
            actorType: ctx.actorType,
            eventType: 'api_token.revoked',
            targetType: 'api_token',
            targetId: input.tokenId,
            metadata: {}
          })
          entry.revokedAt = revokedAt
          yield* publishWebhookEventWith(publisher, {
            eventType: 'api_token.revoked',
            payload: { tokenId: input.tokenId }
          })
          return true
        }, mutation),
        verifyBearerToken: Effect.fn('ApiTokenRegistry.verifyBearerToken')(
          function* (token) {
            const tokenHash = yield* Effect.promise(() => hashApiToken(token))
            const entry = store.find(
              (candidate) =>
                candidate.tokenHash === tokenHash && candidate.revokedAt === null
            )
            const now = yield* DateTime.now
            if (
              !entry ||
              tokenIsExpired(entry.token.expiresAt, DateTime.toEpochMillis(now))
            ) {
              return yield* Effect.fail(
                new AuthorizationDenied({ reason: 'invalid_token' })
              )
            }
            let leaf = entry
            const storeById = new Map(
              store.map((candidate) => [candidate.token.id, candidate])
            )
            while (leaf.token.replacedByTokenId !== null) {
              const next = storeById.get(leaf.token.replacedByTokenId)
              if (next === undefined) {
                break
              }
              leaf = next
            }
            const allowed = yield* entitlements.isActiveForWorkspace({
              workspaceId: entry.workspaceId,
              resource: 'api_token',
              resourceId: leaf.token.id
            })
            if (!allowed) {
              return yield* Effect.fail(
                new AuthorizationDenied({ reason: 'invalid_token' })
              )
            }
            if (
              shouldBumpLastUsedAt(entry.token.lastUsedAt, DateTime.toEpochMillis(now))
            ) {
              entry.token = { ...entry.token, lastUsedAt: DateTime.formatIso(now) }
            }
            return {
              id: entry.token.id,
              workspaceId: entry.workspaceId,
              workspaceSlug: entry.workspaceSlug,
              scopes: entry.token.scopes
            }
          }
        )
      })
    })
  ).pipe(Layer.provide(SeedResourceInventoryLayer))
}
