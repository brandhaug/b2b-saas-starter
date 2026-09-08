import { Clock, DateTime, Effect, Ref } from 'effect'
import * as TestClock from 'effect/testing/TestClock'
import { type expect as vitestExpect } from '@effect/vitest'
import {
  EmailDelivery,
  canResendInvitation,
  isDeliveryUnconfirmed,
  type ClaimEmail,
  type EmailProviderEvent,
  type SendOutcome
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
      name: 'a late accepted receipt survives lease renewal and a newer failed attempt',
      assert: Effect.gen(function* () {
        const delivery = yield* EmailDelivery
        const request = input('late-provider-acceptance')
        const original = yield* delivery.claim(request)
        if (!original) {
          expect.fail('expected original claim')
        }
        yield* TestClock.adjust('5 minutes')
        const renewed = yield* delivery.claim(request)
        if (!renewed) {
          expect.fail('expected renewed claim')
        }
        yield* delivery.recordOutcome(request.id, renewed.token, {
          status: 'temporary_failure',
          reason: 'transport_unavailable'
        })
        yield* delivery.recordOutcome(request.id, original.token, {
          status: 'accepted',
          providerMessageId: 'late-provider-id'
        })
        yield* delivery.recordOutcome(request.id, renewed.token, {
          status: 'failed',
          reason: 'provider_rejected'
        })
        const record = yield* delivery.get(request.id)
        expect(record?.status).toBe('accepted')
        expect(record?.providerMessageId).toBe('late-provider-id')
        expect(record?.acceptedAt).not.toBeNull()
        expect(record?.uncertain).toBe(true)
        yield* TestClock.adjust('10 minutes')
        expect(yield* delivery.claim(request)).toBeNull()
      })
    },
    {
      name: 'relevance cancellation stops retries while preserving racing or known acceptance',
      assert: Effect.gen(function* () {
        const delivery = yield* EmailDelivery
        const request = input('cancelled-in-flight')
        const claim = yield* delivery.claim(request)
        if (!claim) {
          expect.fail('expected claim')
        }
        yield* delivery.abandon(request.id)
        expect((yield* delivery.get(request.id))?.reason).toBe('no_longer_relevant')
        expect(yield* delivery.claim(request)).toBeNull()
        yield* delivery.recordOutcome(request.id, claim.token, {
          status: 'accepted',
          providerMessageId: 'accepted-during-cancel'
        })
        yield* delivery.abandon(request.id)
        expect((yield* delivery.get(request.id))?.status).toBe('accepted')
        const failed = yield* delivery.claim(input('cancelled-transient'))
        if (!failed) {
          expect.fail('expected claim')
        }
        yield* delivery.recordOutcome('cancelled-transient', failed.token, {
          status: 'temporary_failure',
          reason: 'transport_unavailable'
        })
        yield* delivery.abandon('cancelled-transient')
        expect((yield* delivery.get('cancelled-transient'))?.reason).toBe(
          'no_longer_relevant'
        )
      })
    },
    {
      name: 'tracked attempts preserve typed failures and never call the transport after acceptance',
      assert: Effect.gen(function* () {
        const delivery = yield* EmailDelivery
        const calls = yield* Ref.make(0)
        const attempt = Ref.update(calls, (count) => count + 1).pipe(
          Effect.as({
            status: 'accepted',
            providerMessageId: 'tracked-provider'
          } satisfies SendOutcome)
        )
        expect(
          yield* delivery.trackedAttempt(input('tracked'), attempt, () => ({
            status: 'failed',
            reason: 'provider_rejected'
          }))
        ).toEqual({ status: 'accepted' })
        expect(
          yield* delivery.trackedAttempt(input('tracked'), attempt, () => ({
            status: 'failed',
            reason: 'provider_rejected'
          }))
        ).toEqual({ status: 'skipped' })
        expect(yield* Ref.get(calls)).toBe(1)
        const failure = yield* delivery
          .trackedAttempt(input('tracked-failure'), Effect.fail('try-later'), () => ({
            status: 'temporary_failure',
            reason: 'transport_unavailable'
          }))
          .pipe(Effect.flip)
        expect(failure).toBe('try-later')
        expect((yield* delivery.get('tracked-failure'))?.status).toBe(
          'temporary_failure'
        )
        expect(yield* delivery.completionDecision('tracked-failure')).toEqual({
          outcome: 'retry_pending',
          status: 'temporary_failure',
          retryAfterSeconds: 60
        })
        expect(yield* delivery.completionDecision('tracked')).toEqual({
          outcome: 'ack',
          status: 'accepted'
        })
        const active = yield* delivery.claim(input('active-lease'))
        if (!active) {
          expect.fail('expected active lease claim')
        }
        expect(yield* delivery.completionDecision('active-lease')).toEqual({
          outcome: 'retry_pending',
          status: 'queued',
          retryAfterSeconds: 300
        })
      })
    },
    {
      name: 'a complaint strengthens an existing failure and cannot be overwritten by weaker evidence',
      assert: Effect.gen(function* () {
        const delivery = yield* EmailDelivery
        const claim = yield* delivery.claim(input('complaint-precedence'))
        if (!claim) {
          expect.fail('expected claim')
        }
        yield* delivery.recordOutcome('complaint-precedence', claim.token, {
          status: 'accepted',
          providerMessageId: 'complaint-provider'
        })
        const event = {
          messageId: 'complaint-provider',
          recipient: 'owner@live.test',
          status: 'failed',
          reason: 'temporary_failure',
          occurredAt: '2026-09-07T00:00:00Z',
          eventId: 'temporary-failed'
        } satisfies EmailProviderEvent
        expect(yield* delivery.applyProviderEvent(event)).toBe('updated')
        const complaint = {
          ...event,
          reason: 'complaint',
          eventId: 'strong-complaint'
        } satisfies EmailProviderEvent
        expect(yield* delivery.applyProviderEvent(complaint)).toBe('updated')
        expect((yield* delivery.get('complaint-precedence'))?.reason).toBe('complaint')
        expect(yield* delivery.applyProviderEvent(complaint)).toBe('ignored')
        expect(
          yield* delivery.applyProviderEvent({
            ...event,
            reason: 'hard_bounce',
            eventId: 'weaker-bounce'
          })
        ).toBe('ignored')
        expect(
          yield* delivery.applyProviderEvent({
            ...event,
            status: 'delivered',
            eventId: 'late-delivery'
          })
        ).toBe('ignored')
        expect((yield* delivery.get('complaint-precedence'))?.reason).toBe('complaint')
      })
    },
    {
      name: 'bounded retention resumes across evidence pages',
      assert: Effect.gen(function* () {
        const delivery = yield* EmailDelivery
        for (let index = 0; index < 251; index++) {
          for (const purpose of ['normal', 'unresolved']) {
            const request = input(`retention-backlog-${purpose}-${index}`)
            const claim = yield* delivery.claim(request)
            if (!claim) {
              expect.fail('expected retention fixture claim')
            }
            let outcome: SendOutcome = { status: 'logged' }
            if (purpose === 'unresolved') {
              outcome = { status: 'failed', reason: 'provider_rejected' }
            }
            yield* delivery.recordOutcome(request.id, claim.token, outcome)
          }
        }
        yield* TestClock.adjust('90 days')
        const first = yield* delivery.prune()
        expect(first).toBe(500)
        const second = yield* delivery.prune()
        expect(second).toBeGreaterThanOrEqual(2)
        expect(second).toBeLessThanOrEqual(500)
        expect(yield* delivery.get('retention-backlog-normal-250')).toBeNull()
        expect(yield* delivery.get('retention-backlog-unresolved-250')).toBeNull()
        expect(yield* delivery.prune()).toBe(0)
      })
    },
    {
      name: 'invitation reads exclude personal recovery and another workspace, with safe resend policy',
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
        const own = yield* delivery.listInvitations('wrk_live')
        expect(own.map((row) => row.id)).toEqual(['invitation-evidence'])
        const latest = yield* delivery.latestInvitation('wrk_live', 'invite-reference')
        expect(latest?.id).toBe('invitation-evidence')
        expect(canResendInvitation(latest)).toBe(false)
        expect(
          yield* delivery.latestInvitation('wrk_other', 'invite-reference')
        ).toBeNull()
        expect(yield* delivery.listInvitations('wrk_other')).toEqual([])
      })
    },
    {
      name: 'concurrent claims and queue redelivery cannot resend accepted email',
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
      name: 'only correlated events change state and reordered evidence cannot regress terminal outcomes',
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
      name: 'ambiguous retries wait for a lease, remain uncertain, and expire at the original window',
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
        const retryClaim = yield* delivery.claim(input('ambiguous', 'digest'))
        if (!retryClaim) {
          expect.fail('expected the lease to expire')
        }
        expect(yield* delivery.completionDecision('ambiguous')).toEqual({
          outcome: 'retry_pending',
          status: 'ambiguous',
          retryAfterSeconds: 300
        })
        yield* delivery.recordOutcome('ambiguous', retryClaim.token, {
          status: 'ambiguous',
          reason: 'timeout'
        })
        expect((yield* delivery.get('ambiguous'))?.uncertain).toBe(true)
        yield* TestClock.adjust('5 hours')
        yield* TestClock.adjust('54 minutes')
        expect(yield* delivery.completionDecision('ambiguous')).toEqual({
          outcome: 'retry_pending',
          status: 'ambiguous',
          retryAfterSeconds: 1
        })
        yield* TestClock.adjust('1 minute')
        expect(yield* delivery.claim(input('ambiguous', 'digest'))).toBeNull()
        expect((yield* delivery.get('ambiguous'))?.reason).toBe('retry_window_expired')
      })
    },
    {
      name: 'an expired first notification attempt is recorded without granting a send',
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
      name: 'duplicate auth claims cannot invalidate an active immediate send',
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
      name: 'security credentials never become queued retries and permanent failure stops notifications',
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
      name: 'personal evidence is isolated and resolved evidence expires at 30 days, unresolved at 90',
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
