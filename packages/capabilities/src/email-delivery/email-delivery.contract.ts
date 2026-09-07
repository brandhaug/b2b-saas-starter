import { Clock, DateTime, Effect } from 'effect'
import * as TestClock from 'effect/testing/TestClock'
import { type expect as vitestExpect } from '@effect/vitest'
import { testWorkspaceContext } from '../workspace-context.ts'
import {
  EmailDelivery,
  canResendInvitation,
  isDeliveryUnconfirmed,
  type ClaimEmail
} from './email-delivery.ts'

function input(
  id: string,
  purpose: ClaimEmail['purpose'] = 'notification'
): ClaimEmail {
  return {
    id,
    purpose,
    recipient: 'owner@live.test',
    userId: 'usr_owner',
    workspaceId: 'wrk_live'
  }
}
export function emailDeliveryContractCases(expect: typeof vitestExpect) {
  return [
    {
      name: 'AC1: invitation reads exclude personal recovery and another workspace, with safe resend policy',
      assert: Effect.gen(function* () {
        const delivery = yield* EmailDelivery
        const invitation = {
          ...input('invitation-evidence', 'invitation'),
          referenceId: 'invite-reference'
        }
        const claim = yield* delivery.claim(invitation)
        if (!claim) {
          expect.fail('expected invitation claim')
        }
        yield* delivery.recordOutcome(invitation.id, claim.token, {
          status: 'suppressed',
          reason: 'provider_suppressed'
        })
        yield* delivery.claim({
          ...input('private-recovery', 'recovery'),
          referenceId: 'invite-reference'
        })
        const ownContext = testWorkspaceContext({
          id: 'wrk_live',
          slug: 'live-lab',
          name: 'Live Lab',
          planId: 'free'
        })
        const otherContext = testWorkspaceContext({
          id: 'wrk_other',
          slug: 'other-lab',
          name: 'Other Lab',
          planId: 'free'
        })
        const own = yield* delivery.listInvitations().pipe(Effect.provide(ownContext))
        expect(own.map((row) => row.id)).toEqual(['invitation-evidence'])
        const latest = yield* delivery
          .latestInvitation('invite-reference')
          .pipe(Effect.provide(ownContext))
        expect(latest?.id).toBe('invitation-evidence')
        expect(canResendInvitation(latest)).toBe(false)
        expect(
          yield* delivery
            .latestInvitation('invite-reference')
            .pipe(Effect.provide(otherContext))
        ).toBeNull()
        expect(
          yield* delivery.listInvitations().pipe(Effect.provide(otherContext))
        ).toEqual([])
      })
    },
    {
      name: 'AC3: concurrent claims and queue redelivery cannot resend accepted email',
      assert: Effect.gen(function* () {
        const delivery = yield* EmailDelivery
        const claims = yield* Effect.all(
          [delivery.claim(input('concurrent')), delivery.claim(input('concurrent'))],
          { concurrency: 'unbounded' }
        )
        expect(claims.filter(Boolean)).toHaveLength(1)
        const claim = claims.find((value) => value !== null)
        if (!claim) {
          expect.fail('expected a send claim')
        }
        yield* delivery.recordOutcome('concurrent', claim.token, {
          status: 'accepted',
          providerMessageId: 'provider-concurrent'
        })
        yield* TestClock.adjust('25 hours')
        expect(yield* delivery.claim(input('concurrent'))).toBeNull()
        const record = yield* delivery.get('concurrent')
        expect(record?.status).toBe('accepted')
        if (record) {
          expect(isDeliveryUnconfirmed(record, yield* Clock.currentTimeMillis)).toBe(
            true
          )
        }
      })
    },
    {
      name: 'AC3: only correlated events change state and reordered evidence cannot regress terminal outcomes',
      assert: Effect.gen(function* () {
        const delivery = yield* EmailDelivery
        const claim = yield* delivery.claim(input('events'))
        if (!claim) {
          expect.fail('expected a send claim')
        }
        yield* delivery.recordOutcome('events', claim.token, {
          status: 'accepted',
          providerMessageId: 'provider-events'
        })
        const event = {
          eventId: 'event-delivered',
          messageId: 'provider-events',
          recipient: 'owner@live.test',
          status: 'delivered',
          occurredAt: '2026-09-07T00:00:00Z'
        } satisfies Parameters<typeof delivery.applyProviderEvent>[0]
        expect(
          yield* delivery.applyProviderEvent({
            ...event,
            recipient: 'outsider@live.test'
          })
        ).toBe('unmatched')
        expect(yield* delivery.applyProviderEvent(event)).toBe('updated')
        expect(yield* delivery.applyProviderEvent(event)).toBe('ignored')
        expect(
          yield* delivery.applyProviderEvent({
            ...event,
            eventId: 'old-delay',
            status: 'delayed'
          })
        ).toBe('ignored')
        expect((yield* delivery.get('events'))?.status).toBe('delivered')
        expect(
          yield* delivery.applyProviderEvent({
            ...event,
            eventId: 'complaint',
            status: 'suppressed',
            reason: 'complaint'
          })
        ).toBe('updated')
        expect(yield* delivery.applyProviderEvent(event)).toBe('ignored')
        expect(yield* delivery.claim(input('events'))).toBeNull()
      })
    },
    {
      name: 'AC6: ambiguous retries wait for a lease, remain uncertain, and expire at the original window',
      assert: Effect.gen(function* () {
        const delivery = yield* EmailDelivery
        const claim = yield* delivery.claim(input('ambiguous', 'digest'))
        if (!claim) {
          expect.fail('expected a send claim')
        }
        yield* delivery.recordOutcome('ambiguous', claim.token, {
          status: 'ambiguous',
          reason: 'timeout'
        })
        expect(yield* delivery.claim(input('ambiguous', 'digest'))).toBeNull()
        yield* TestClock.adjust('5 minutes')
        expect(yield* delivery.claim(input('ambiguous', 'digest'))).not.toBeNull()
        expect((yield* delivery.get('ambiguous'))?.uncertain).toBe(true)
        yield* TestClock.adjust('6 hours')
        expect(yield* delivery.claim(input('ambiguous', 'digest'))).toBeNull()
        expect((yield* delivery.get('ambiguous'))?.reason).toBe('retry_window_expired')
      })
    },
    {
      name: 'AC6: an expired first notification attempt is recorded without granting a send',
      assert: Effect.gen(function* () {
        const delivery = yield* EmailDelivery
        const now = yield* Clock.currentTimeMillis
        const queuedAt = DateTime.formatIso(DateTime.makeUnsafe(now))
        yield* TestClock.adjust('24 hours')
        expect(
          yield* delivery.claim({ ...input('late-first-attempt'), queuedAt })
        ).toBeNull()
        expect((yield* delivery.get('late-first-attempt'))?.reason).toBe(
          'retry_window_expired'
        )
      })
    },
    {
      name: 'AC3: duplicate auth claims cannot invalidate an active immediate send',
      assert: Effect.gen(function* () {
        const delivery = yield* EmailDelivery
        const request = input('immediate-auth', 'recovery')
        const claim = yield* delivery.claim(request)
        if (!claim) {
          expect.fail('expected an immediate send claim')
        }
        expect(yield* delivery.claim(request)).toBeNull()
        yield* delivery.recordOutcome(request.id, claim.token, {
          status: 'accepted',
          providerMessageId: 'auth-provider-id'
        })
        expect((yield* delivery.get(request.id))?.status).toBe('accepted')
      })
    },
    {
      name: 'AC6: security credentials never become queued retries and permanent failure stops notifications',
      assert: Effect.gen(function* () {
        const delivery = yield* EmailDelivery
        for (const purpose of ['recovery', 'notification'] satisfies ReadonlyArray<
          ClaimEmail['purpose']
        >) {
          const request = input(`failed-${purpose}`, purpose)
          const claim = yield* delivery.claim(request)
          if (!claim) {
            expect.fail('expected a send claim')
          }
          if (purpose === 'recovery') {
            yield* delivery.recordOutcome(request.id, claim.token, {
              status: 'temporary_failure',
              reason: 'provider_rejected'
            })
          } else {
            yield* delivery.recordOutcome(request.id, claim.token, {
              status: 'failed',
              reason: 'provider_rejected'
            })
          }
          yield* TestClock.adjust('10 minutes')
          expect(yield* delivery.claim(request)).toBeNull()
        }
      })
    },
    {
      name: 'AC6: personal evidence is isolated and resolved evidence expires at 30 days, unresolved at 90',
      assert: Effect.gen(function* () {
        const delivery = yield* EmailDelivery
        for (const id of ['retention-normal', 'retention-failed']) {
          const claim = yield* delivery.claim(input(id))
          if (!claim) {
            expect.fail('expected a send claim')
          }
          if (id === 'retention-normal') {
            yield* delivery.recordOutcome(id, claim.token, { status: 'logged' })
          } else {
            yield* delivery.recordOutcome(id, claim.token, {
              status: 'failed',
              reason: 'provider_rejected'
            })
          }
        }
        expect(yield* delivery.listForUser('usr_outsider')).toEqual([])
        expect(
          (yield* delivery.listForUser('usr_owner')).some(
            (row) => row.id === 'retention-failed'
          )
        ).toBe(true)
        yield* TestClock.adjust('30 days')
        yield* delivery.prune()
        expect(yield* delivery.get('retention-normal')).toBeNull()
        expect(yield* delivery.get('retention-failed')).not.toBeNull()
        yield* TestClock.adjust('60 days')
        yield* delivery.prune()
        expect(yield* delivery.get('retention-failed')).toBeNull()
      })
    }
  ]
}
