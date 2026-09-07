import { WorkspaceContext } from '../workspace-context.ts'
import { WebhookEndpoints } from '../developer-platform/webhook-endpoints.ts'
import { Deferred, Effect, Layer, Ref } from 'effect'
import { expect, layer } from '@effect/vitest'
import { eq } from 'drizzle-orm'
import { Database, RawD1 } from '@b2b-saas-starter/db/service'
import {
  apiTokens,
  webhookEndpoints,
  workspaceResourceSelections,
  workspaceSubscriptions
} from '@b2b-saas-starter/db/schema'
import {
  TestDatabase,
  inWorkspace,
  LIVE_SUITE_TIMEOUT
} from '../testing/live-harness.ts'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { LiveApiTokenRegistry } from '../developer-platform/api-token-registry.live.ts'
import { ApiTokenRegistry } from '../developer-platform/api-token-registry.ts'
import { failureTag } from '../internal/failure-tag.ts'
import { ResourceEntitlements } from './resource-entitlements.ts'
import {
  resourceEntitlementsContract,
  resourceDeadlineCases
} from './resource-entitlements.contract.ts'

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'Live resource authority',
  (it) => {
    for (const scenario of resourceDeadlineCases) {
      it.effect(`Live resource authority after ${scenario.name}`, () =>
        Effect.gen(function* () {
          const db = yield* Database
          yield* db.delete(apiTokens).where(eq(apiTokens.workspaceId, 'wrk_live'))
          yield* db
            .delete(webhookEndpoints)
            .where(eq(webhookEndpoints.workspaceId, 'wrk_live'))
          yield* db
            .delete(workspaceResourceSelections)
            .where(eq(workspaceResourceSelections.workspaceId, 'wrk_live'))
          yield* db
            .delete(workspaceSubscriptions)
            .where(eq(workspaceSubscriptions.workspaceId, 'wrk_live'))
          yield* db.insert(workspaceSubscriptions).values({
            workspaceId: 'wrk_live',
            stripeCustomerId: 'cus_resources',
            stripeSubscriptionId: 'sub_resources',
            subscribedPlanId: 'team',
            updatedAt: '2026-09-01T00:00:00.000Z',
            ...scenario.state
          })
          yield* inWorkspace('live-lab', resourceEntitlementsContract(expect), {
            userId: 'usr_owner'
          })
        })
      )
    }
    it.effect('malformed stored selection fails in the typed channel', () =>
      Effect.gen(function* () {
        const d1 = yield* RawD1
        yield* Effect.promise(() =>
          d1
            .prepare(
              "INSERT INTO workspace_resource_selections (workspace_id,api_token_ids,webhook_endpoint_ids,updated_at) VALUES ('wrk_other','{}','[]','now')"
            )
            .run()
        )
        yield* inWorkspace(
          'dev-contract-lab',
          Effect.gen(function* () {
            const selection = yield* ResourceEntitlements
            const tokens = yield* ApiTokenRegistry
            const endpoints = yield* WebhookEndpoints
            const ctx = yield* WorkspaceContext
            const foreignContext = {
              ...ctx,
              workspace: { ...ctx.workspace, id: 'wrk_other', slug: 'other-lab' }
            }
            const foreignToken = yield* tokens
              .create({ name: 'foreign credential', scopes: ['read'] })
              .pipe(Effect.provideService(WorkspaceContext, foreignContext))
            const foreignEndpoint = yield* endpoints
              .create({ url: 'https://example.com/foreign', events: [] })
              .pipe(Effect.provideService(WorkspaceContext, foreignContext))
            expect(
              failureTag(
                yield* Effect.exit(
                  selection.select({
                    apiTokenIds: [foreignToken.id],
                    webhookEndpointIds: []
                  })
                )
              )
            ).toBe('ResourceSelectionRejected')
            expect(
              failureTag(
                yield* Effect.exit(
                  selection.select({
                    apiTokenIds: [],
                    webhookEndpointIds: [foreignEndpoint.endpoint.id]
                  })
                )
              )
            ).toBe('ResourceSelectionRejected')
            expect(
              failureTag(
                yield* Effect.exit(tokens.verifyBearerToken(foreignToken.token))
              )
            ).toBe('CapabilityUnavailable')
            expect(
              failureTag(
                yield* Effect.exit(
                  endpoints.getDispatchTarget(foreignEndpoint.endpoint.id, 'wrk_other')
                )
              )
            ).toBe('CapabilityUnavailable')
            expect(
              failureTag(
                yield* Effect.exit(selection.getSelectionForWorkspace('wrk_other'))
              )
            ).toBe('CapabilityUnavailable')
          }),
          { userId: 'usr_owner' }
        )
      })
    )
    it.effect('selection audit failure rolls back the selection write', () =>
      Effect.gen(function* () {
        const db = yield* Database
        const d1 = yield* RawD1
        const before = yield* db.select().from(workspaceResourceSelections)
        yield* Effect.acquireUseRelease(
          Effect.promise(() =>
            d1
              .prepare(
                "CREATE TRIGGER reject_resource_selection BEFORE INSERT ON audit_events WHEN NEW.event_type='billing.resource_selection_updated' BEGIN SELECT RAISE(ABORT,'reject'); END"
              )
              .run()
          ),
          () =>
            inWorkspace(
              'dev-contract-lab',
              Effect.gen(function* () {
                const selection = yield* ResourceEntitlements
                expect(
                  failureTag(
                    yield* Effect.exit(
                      selection.select({ apiTokenIds: [], webhookEndpointIds: [] })
                    )
                  )
                ).toBe('CapabilityUnavailable')
                expect(yield* db.select().from(workspaceResourceSelections)).toEqual(
                  before
                )
              }),
              { userId: 'usr_owner' }
            ),
          () =>
            Effect.promise(() =>
              d1.prepare('DROP TRIGGER reject_resource_selection').run()
            )
        )
      })
    )
    it.effect(
      'two selected rotations interleaved after selection reads retain both slots',
      () =>
        inWorkspace(
          'dev-contract-lab',
          Effect.gen(function* () {
            const tokens = yield* ApiTokenRegistry
            const selection = yield* ResourceEntitlements
            const audit = yield* AuditEventLog
            const originals = yield* Effect.forEach([1, 2, 3], (id) =>
              tokens.create({ name: `concurrent-${id}`, scopes: ['read'] })
            )
            const parents = originals.slice(0, 2)
            yield* selection.select({
              apiTokenIds: parents.map((token) => token.id),
              webhookEndpointIds: []
            })
            const ready = yield* Deferred.make<undefined>()
            const arrivals = yield* Ref.make(0)
            const racingAudit = Layer.succeed(
              AuditEventLog,
              AuditEventLog.of({
                ...audit,
                prepareRecord: (input) =>
                  Effect.gen(function* () {
                    if (input.eventType === 'api_token.replaced') {
                      if ((yield* Ref.updateAndGet(arrivals, (n) => n + 1)) === 2) {
                        yield* Deferred.succeed(ready, undefined)
                      }
                      yield* Deferred.await(ready)
                    }
                    return yield* audit.prepareRecord(input)
                  })
              })
            )
            const replacements = yield* Effect.gen(function* () {
              const racing = yield* ApiTokenRegistry
              return yield* Effect.all(
                parents.map((token) =>
                  racing.replace({
                    tokenId: token.id,
                    scopes: ['read'],
                    overlapSeconds: 0
                  })
                ),
                { concurrency: 'unbounded' }
              )
            }).pipe(
              Effect.provide(
                Layer.fresh(LiveApiTokenRegistry()).pipe(Layer.provide(racingAudit))
              )
            )
            expect(new Set((yield* selection.getSelection()).apiTokenIds)).toEqual(
              new Set(replacements.map((token) => token.id))
            )
          }),
          { userId: 'usr_owner' }
        )
    )
  }
)
