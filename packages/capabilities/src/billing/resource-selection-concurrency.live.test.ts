import { WorkspaceContext } from '../workspace-context.ts'
import { Array, Effect, Layer } from 'effect'
import { expect, layer } from '@effect/vitest'
import { Database } from '@b2b-saas-starter/db/service'
import { workspaces } from '@b2b-saas-starter/db/schema'
import { eq } from 'drizzle-orm'
import {
  TestDatabase,
  inWorkspace,
  LIVE_SUITE_TIMEOUT
} from '../testing/live-harness.ts'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { ApiTokenRegistry } from '../developer-platform/api-token-registry.ts'
import { LiveApiTokenRegistry } from '../developer-platform/api-token-registry.live.ts'
import { ResourceEntitlements } from './resource-entitlements.ts'
import { LiveResourceEntitlements } from './resource-entitlements.live.ts'

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'selection and rotation contention',
  (it) => {
    it.effect(
      'selection saved after a rotation read is not overwritten by that rotation',
      () =>
        inWorkspace(
          'dev-contract-lab',
          Effect.gen(function* () {
            const tokens = yield* ApiTokenRegistry
            const selection = yield* ResourceEntitlements
            const audit = yield* AuditEventLog
            const ctx = yield* WorkspaceContext
            const created = yield* Effect.forEach([1, 2, 3], (n) =>
              tokens.create({ name: `select-before-rotate-${n}`, scopes: ['read'] })
            )
            const a = Array.getUnsafe(created, 0)
            const b = Array.getUnsafe(created, 1)
            const c = Array.getUnsafe(created, 2)
            yield* selection.select({
              apiTokenIds: [a.id, b.id],
              webhookEndpointIds: []
            })
            const racingAudit = Layer.succeed(
              AuditEventLog,
              AuditEventLog.of({
                ...audit,
                prepareRecord: (input) =>
                  Effect.gen(function* () {
                    if (input.eventType === 'api_token.replaced') {
                      yield* selection.select({
                        apiTokenIds: [b.id, c.id],
                        webhookEndpointIds: []
                      })
                    }
                    return yield* audit.prepareRecord(input)
                  }).pipe(Effect.provideService(WorkspaceContext, ctx), Effect.orDie)
              })
            )
            yield* Effect.gen(function* () {
              const racing = yield* ApiTokenRegistry
              yield* racing.replace({
                tokenId: a.id,
                scopes: ['read'],
                overlapSeconds: 0
              })
            }).pipe(
              Effect.provide(
                Layer.fresh(LiveApiTokenRegistry()).pipe(Layer.provide(racingAudit))
              )
            )
            expect(new Set((yield* selection.getSelection()).apiTokenIds)).toEqual(
              new Set([b.id, c.id])
            )
          }),
          { userId: 'usr_owner' }
        )
    )

    it.effect(
      'a pending selection resolves a token rotated before the selection batch',
      () =>
        inWorkspace(
          'dev-contract-lab',
          Effect.gen(function* () {
            const db = yield* Database
            const tokens = yield* ApiTokenRegistry
            const selection = yield* ResourceEntitlements
            const audit = yield* AuditEventLog
            const ctx = yield* WorkspaceContext
            const created = yield* Effect.forEach([1, 2, 3], (n) =>
              tokens.create({ name: `rotate-before-select-${n}`, scopes: ['read'] })
            )
            const a = Array.getUnsafe(created, 0)
            const b = Array.getUnsafe(created, 1)
            const c = Array.getUnsafe(created, 2)
            let replacement = a
            const racingAudit = Layer.succeed(
              AuditEventLog,
              AuditEventLog.of({
                ...audit,
                prepareRecord: (input) =>
                  Effect.gen(function* () {
                    if (input.eventType === 'billing.resource_selection_updated') {
                      replacement = yield* tokens.replace({
                        tokenId: a.id,
                        scopes: ['read'],
                        overlapSeconds: 0
                      })
                    }
                    return yield* audit.prepareRecord(input)
                  }).pipe(Effect.provideService(WorkspaceContext, ctx), Effect.orDie)
              })
            )
            const saved = yield* Effect.gen(function* () {
              const racing = yield* ResourceEntitlements
              return yield* racing.select({
                apiTokenIds: [a.id, c.id],
                webhookEndpointIds: []
              })
            }).pipe(
              Effect.provide(
                Layer.fresh(LiveResourceEntitlements).pipe(Layer.provide(racingAudit))
              )
            )
            expect(new Set(saved.apiTokenIds)).toEqual(new Set([replacement.id, c.id]))
            yield* db
              .update(workspaces)
              .set({ planId: 'starter' })
              .where(eq(workspaces.id, 'wrk_dev_contract'))
            yield* tokens.verifyBearerToken(replacement.token)
            yield* tokens.verifyBearerToken(c.token)
            expect((yield* Effect.flip(tokens.verifyBearerToken(b.token)))._tag).toBe(
              'AuthorizationDenied'
            )
            expect(new Set((yield* selection.getSelection()).apiTokenIds)).toEqual(
              new Set([replacement.id, c.id])
            )
          }),
          { userId: 'usr_owner' }
        )
    )
  }
)
