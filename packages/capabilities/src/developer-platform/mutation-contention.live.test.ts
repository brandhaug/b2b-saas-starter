import { Database } from '@b2b-saas-starter/db/service'
import { apiTokens, auditEvents, webhookEndpoints } from '@b2b-saas-starter/db/schema'
import { Effect, Layer } from 'effect'
import { eq } from 'drizzle-orm'
import { expect, layer } from '@effect/vitest'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { WorkspaceContext, testWorkspaceContext } from '../workspace-context.ts'
import {
  TestDatabase,
  inWorkspace,
  LIVE_SUITE_TIMEOUT
} from '../testing/live-harness.ts'
import { ApiTokenRegistry } from './api-token-registry.ts'
import { LiveApiTokenRegistry } from './api-token-registry.live.ts'
import { WebhookEndpoints } from './webhook-endpoints.ts'
import { LiveWebhookEndpoints } from './webhook-endpoints.live.ts'
import { failureTag } from '../internal/failure-tag.ts'

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })('mutation contention', (it) => {
  it.effect(
    'a revoke losing after its lookup returns false without duplicate evidence',
    () =>
      inWorkspace(
        'dev-contract-lab',
        Effect.gen(function* () {
          const tokens = yield* ApiTokenRegistry
          const audit = yield* AuditEventLog
          const db = yield* Database
          const ctx = yield* WorkspaceContext
          const token = yield* tokens.create({ name: 'revoke-race', scopes: ['read'] })
          const racingAudit = Layer.succeed(
            AuditEventLog,
            AuditEventLog.of({
              ...audit,
              prepareRecord: (input, condition) =>
                Effect.gen(function* () {
                  if (input.eventType === 'api_token.revoked') {
                    expect(yield* tokens.revoke({ tokenId: token.id })).toBe(true)
                  }
                  return yield* audit.prepareRecord(input, condition)
                }).pipe(
                  Effect.provide(
                    testWorkspaceContext(ctx.workspace, ctx.actor, ctx.actorType)
                  )
                )
            })
          )
          const result = yield* Effect.gen(function* () {
            return yield* (yield* ApiTokenRegistry).revoke({ tokenId: token.id })
          }).pipe(
            Effect.provide(
              Layer.fresh(LiveApiTokenRegistry()).pipe(Layer.provide(racingAudit))
            )
          )
          expect(result).toBe(false)
          const rows = yield* db
            .select()
            .from(auditEvents)
            .where(eq(auditEvents.targetId, token.id))
          expect(
            rows.filter((row) => row.eventType === 'api_token.revoked')
          ).toHaveLength(1)
        }),
        { userId: 'usr_owner' }
      )
  )

  for (const operation of ['update', 'delete', 'rotateSecret'] satisfies ReadonlyArray<
    'update' | 'delete' | 'rotateSecret'
  >) {
    it.effect(
      `a webhook ${operation} losing to deletion reports not found without audit`,
      () =>
        inWorkspace(
          'dev-contract-lab',
          Effect.gen(function* () {
            const endpoints = yield* WebhookEndpoints
            const audit = yield* AuditEventLog
            const db = yield* Database
            const ctx = yield* WorkspaceContext
            const created = yield* endpoints.create({
              url: 'https://example.com/deleted',
              events: []
            })
            const racingAudit = Layer.succeed(
              AuditEventLog,
              AuditEventLog.of({
                ...audit,
                prepareRecord: (input, condition) =>
                  Effect.gen(function* () {
                    yield* endpoints
                      .delete({ endpointId: created.endpoint.id })
                      .pipe(Effect.orDie)
                    return yield* audit.prepareRecord(input, condition)
                  }).pipe(
                    Effect.provide(
                      testWorkspaceContext(ctx.workspace, ctx.actor, ctx.actorType)
                    )
                  )
              })
            )
            const result = yield* Effect.exit(
              Effect.gen(function* () {
                const racing = yield* WebhookEndpoints
                const input = { endpointId: created.endpoint.id, enabled: false }
                return yield* racing[operation](input)
              }).pipe(
                Effect.provide(
                  Layer.fresh(LiveWebhookEndpoints).pipe(Layer.provide(racingAudit))
                )
              )
            )
            expect(failureTag(result)).toBe('WebhookEndpointNotFound')
            const rows = yield* db
              .select()
              .from(auditEvents)
              .where(eq(auditEvents.targetId, created.endpoint.id))
            expect(rows.map((row) => row.eventType).toSorted()).toEqual([
              'webhook_endpoint.created',
              'webhook_endpoint.deleted'
            ])
          }),
          { userId: 'usr_owner' }
        )
    )
  }

  for (const resource of ['api_token', 'webhook_endpoint'] satisfies ReadonlyArray<
    'api_token' | 'webhook_endpoint'
  >) {
    it.effect(`${resource} admits only one contender for the last slot`, () =>
      inWorkspace(
        'capped-lab',
        Effect.gen(function* () {
          const db = yield* Database
          const ctx = yield* WorkspaceContext
          const audit = yield* AuditEventLog
          const tokens = yield* ApiTokenRegistry
          const endpoints = yield* WebhookEndpoints
          yield* db.delete(apiTokens).where(eq(apiTokens.workspaceId, ctx.workspace.id))
          yield* db
            .delete(webhookEndpoints)
            .where(eq(webhookEndpoints.workspaceId, ctx.workspace.id))
          if (resource === 'api_token') {
            yield* tokens.create({ name: 'first-slot', scopes: ['read'] })
          }
          const create = Effect.gen(function* () {
            if (resource === 'api_token') {
              return yield* (yield* ApiTokenRegistry).create({
                name: 'last-slot',
                scopes: ['read']
              })
            }
            return yield* (yield* WebhookEndpoints).create({
              url: 'https://example.com/race',
              events: ['api_token.created']
            })
          })
          const before = yield* db
            .select()
            .from(auditEvents)
            .where(eq(auditEvents.workspaceId, ctx.workspace.id))
          const racingAudit = Layer.succeed(
            AuditEventLog,
            AuditEventLog.of({
              ...audit,
              prepareRecord: (input, condition) =>
                Effect.gen(function* () {
                  if (input.eventType === `${resource}.created`) {
                    yield* create.pipe(
                      Effect.provideService(ApiTokenRegistry, tokens),
                      Effect.provideService(WebhookEndpoints, endpoints),
                      Effect.orDie
                    )
                  }
                  return yield* audit.prepareRecord(input, condition)
                }).pipe(
                  Effect.provide(
                    testWorkspaceContext(ctx.workspace, ctx.actor, ctx.actorType)
                  )
                )
            })
          )
          const racing = Layer.mergeAll(
            LiveApiTokenRegistry(),
            LiveWebhookEndpoints
          ).pipe(Layer.provide(racingAudit))
          const result = yield* Effect.exit(
            create.pipe(Effect.provide(Layer.fresh(racing)))
          )
          expect(failureTag(result)).toBe('PlanLimitExceeded')
          if (resource === 'api_token') {
            expect(yield* tokens.list).toHaveLength(2)
          } else {
            expect(yield* endpoints.list).toHaveLength(1)
          }
          const after = yield* db
            .select()
            .from(auditEvents)
            .where(eq(auditEvents.workspaceId, ctx.workspace.id))
          expect(
            after.filter((row) => row.eventType === `${resource}.created`).length -
              before.filter((row) => row.eventType === `${resource}.created`).length
          ).toBe(1)
        }),
        { userId: 'usr_owner' }
      )
    )
  }
})
