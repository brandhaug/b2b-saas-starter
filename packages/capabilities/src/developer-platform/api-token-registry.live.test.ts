import { Effect } from 'effect'
import { describe, expect, layer } from '@effect/vitest'

import { AuditEventLog } from '../governance/audit-event-log.ts'
import {
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestDatabase
} from '../testing/live-harness.ts'
import { ApiTokenRegistry } from './api-token-registry.ts'

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'live api token registry',
  (it) => {
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
              return (yield* audit.list()).events
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
