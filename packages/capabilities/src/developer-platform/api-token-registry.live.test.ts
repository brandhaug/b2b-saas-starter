import { Effect, Exit } from 'effect'
import { Database } from '@b2b-saas-starter/db/service'
import { apiTokens, auditEvents } from '@b2b-saas-starter/db/schema'
import { eq } from 'drizzle-orm'
import { failureTag } from '../internal/failure-tag.ts'
import { describe, expect, layer } from '@effect/vitest'

import { AuditEventLog } from '../governance/audit-event-log.ts'
import {
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestDatabase,
  TestD1
} from '../testing/live-harness.ts'
import { apiTokenRegistryContractCases } from './api-token-registry.contract.ts'
import { ApiTokenRegistry } from './api-token-registry.ts'

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'live api token registry',
  (it) => {
    for (const contractCase of apiTokenRegistryContractCases(expect)) {
      it.effect(contractCase.name, () =>
        inWorkspace('dev-contract-lab', contractCase.assert, { userId: 'usr_owner' })
      )
    }
    for (const failure of [
      {
        name: 'replacement insert',
        table: 'api_tokens',
        condition: "NEW.name = 'rollback-insert'",
        tokenName: 'rollback-insert'
      },
      {
        name: 'audit insert',
        table: 'audit_events',
        condition: "NEW.event_type = 'api_token.replaced'",
        tokenName: 'rollback-audit'
      }
    ]) {
      it.effect(
        `rolls back retirement and replacement when the ${failure.name} fails`,
        () =>
          Effect.gen(function* () {
            const d1 = yield* TestD1
            const db = yield* Database
            const created = yield* inWorkspace(
              'dev-contract-lab',
              Effect.gen(function* () {
                const registry = yield* ApiTokenRegistry
                return yield* registry.create({
                  name: failure.tokenName,
                  scopes: ['read']
                })
              })
            )
            const beforeTokens = yield* db.select().from(apiTokens)
            const beforeAudit = yield* db.select().from(auditEvents)
            yield* Effect.acquireUseRelease(
              Effect.promise(() =>
                d1
                  .prepare(
                    `CREATE TRIGGER reject_token_replacement BEFORE INSERT ON ${failure.table} WHEN ${failure.condition} BEGIN SELECT RAISE(ABORT, 'forced replacement failure'); END`
                  )
                  .run()
              ),
              () =>
                Effect.gen(function* () {
                  const result = yield* Effect.exit(
                    inWorkspace(
                      'dev-contract-lab',
                      Effect.gen(function* () {
                        const registry = yield* ApiTokenRegistry
                        return yield* registry.replace({
                          tokenId: created.id,
                          scopes: ['read'],
                          overlapSeconds: 0
                        })
                      })
                    )
                  )
                  expect(failureTag(result)).toBe('CapabilityUnavailable')
                  expect(yield* db.select().from(apiTokens)).toEqual(beforeTokens)
                  expect(yield* db.select().from(auditEvents)).toEqual(beforeAudit)
                }),
              () =>
                Effect.promise(() =>
                  d1.prepare('DROP TRIGGER reject_token_replacement').run()
                )
            )
            yield* inWorkspace(
              'dev-contract-lab',
              Effect.gen(function* () {
                const registry = yield* ApiTokenRegistry
                yield* registry.verifyBearerToken(created.token)
                const retry = yield* registry.replace({
                  tokenId: created.id,
                  scopes: ['read'],
                  overlapSeconds: 0
                })
                yield* registry.verifyBearerToken(retry.token)
              })
            )
          })
      )
    }
    it.effect(
      'racing replacements commit exactly one child and its linked audit evidence',
      () =>
        Effect.gen(function* () {
          const db = yield* Database
          yield* inWorkspace(
            'dev-contract-lab',
            Effect.gen(function* () {
              const registry = yield* ApiTokenRegistry
              const original = yield* registry.create({
                name: 'racing rotation',
                scopes: ['read', 'write']
              })
              const outcomes = yield* Effect.all(
                [
                  Effect.exit(
                    registry.replace({
                      tokenId: original.id,
                      scopes: ['read'],
                      overlapSeconds: 60
                    })
                  ),
                  Effect.exit(
                    registry.replace({
                      tokenId: original.id,
                      scopes: ['read'],
                      overlapSeconds: 60
                    })
                  )
                ],
                { concurrency: 'unbounded' }
              )
              const winners = outcomes.filter(Exit.isSuccess)
              expect(winners).toHaveLength(1)
              const winner = winners[0]
              expect(winner).toBeDefined()
              if (!winner) {
                return
              }
              const rows = yield* db
                .select()
                .from(apiTokens)
                .where(eq(apiTokens.name, original.name))
              expect(rows).toHaveLength(2)
              expect(
                rows.find((row) => row.id === original.id)?.replacedByTokenId
              ).toBe(winner.value.id)
              expect(rows.every((row) => row.tokenHash !== winner.value.token)).toBe(
                true
              )
              const events = yield* db
                .select()
                .from(auditEvents)
                .where(eq(auditEvents.targetId, winner.value.id))
              expect(events).toHaveLength(1)
              expect(events[0]).toMatchObject({
                eventType: 'api_token.replaced',
                metadata: {
                  previousTokenId: original.id,
                  replacementTokenId: winner.value.id
                }
              })
              yield* registry.verifyBearerToken(winner.value.token)
            })
          )
        })
    )
    describe('live api token lifecycle', () => {
      it.effect('creates, verifies, lists, revokes, and audits a token', () =>
        Effect.gen(function* () {
          const created = yield* inWorkspace(
            'live-lab',
            Effect.gen(function* () {
              const registry = yield* ApiTokenRegistry
              return yield* registry.create({
                name: 'Live test token',
                scopes: ['read', 'write']
              })
            }),
            { userId: 'usr_owner' }
          )
          expect(created.token.startsWith('bsk_live_')).toBe(true)
          expect(created.prefix).toBe(created.token.slice(0, 17))

          const verified = yield* inWorkspace(
            'live-lab',
            Effect.gen(function* () {
              const registry = yield* ApiTokenRegistry
              return yield* registry.verifyBearerToken(created.token)
            })
          )
          expect(verified.workspaceSlug).toBe('live-lab')
          // Verification reports the token's own scopes and stops there. It no
          // longer judges them: `admin` is absent from this list, and saying so
          // is the whole of its answer.
          expect(verified.scopes).toEqual(['read', 'write'])

          const listed = yield* inWorkspace(
            'live-lab',
            Effect.gen(function* () {
              const registry = yield* ApiTokenRegistry
              return yield* registry.list
            })
          )
          const listedToken = listed.find((token) => token.id === created.id)
          expect(listedToken?.prefix).toBe(created.prefix)
          // The raw token is returned once at creation and never listed.
          const listedValues = listed.flatMap((token) => Object.values(token).flat())
          expect(listedValues).not.toContain(created.token)

          const revoked = yield* inWorkspace(
            'live-lab',
            Effect.gen(function* () {
              const registry = yield* ApiTokenRegistry
              return yield* registry.revoke({
                tokenId: created.id
              })
            }),
            { userId: 'usr_owner' }
          )
          expect(revoked).toBe(true)

          const afterRevoke = yield* inWorkspace(
            'live-lab',
            Effect.gen(function* () {
              const registry = yield* ApiTokenRegistry
              return yield* Effect.flip(registry.verifyBearerToken(created.token))
            })
          )
          expect(afterRevoke.reason).toBe('invalid_token')

          // Both mutations committed their audit rows atomically alongside the write.
          const events = yield* inWorkspace(
            'live-lab',
            Effect.gen(function* () {
              const audit = yield* AuditEventLog
              return (yield* audit.list()).items
            })
          )
          const types = events.map((event) => event.eventType)
          expect(types).toContain('api_token.created')
          expect(types).toContain('api_token.revoked')
          expect(
            events.find((event) => event.eventType === 'api_token.created')?.actor
          ).toBe('Owner One')
        })
      )
    })
  }
)
