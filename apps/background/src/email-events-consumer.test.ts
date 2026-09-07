import { EmailDelivery } from '@b2b-saas-starter/capabilities/email-delivery/email-delivery'
import { SeedEmailDelivery } from '@b2b-saas-starter/capabilities/email-delivery/email-delivery.seed'
import { Effect, type Scope } from 'effect'
import { describe, expect, it } from '@effect/vitest'

import {
  CloudflareEmailSendingEvent,
  processEmailEventMessage
} from './email-events-consumer.ts'
import { readDelivery } from './queue-consumer.ts'

const from = 'noreply@example.com'
const recipient = 'user@example.net'

type EventOptions = {
  readonly type?: string
  readonly sourceType?: string
  readonly sourceDomain?: string
  readonly eventId?: string
  readonly messageId?: string
  readonly sender?: string
  readonly deliveryStatus?: string
  readonly terminal?: boolean
  readonly bounceType?: 'hard' | 'soft'
  readonly rejectionReason?: string
}

function event(options: EventOptions = {}) {
  const payload = {
    eventId: options.eventId ?? 'evt_1',
    messageId: options.messageId ?? 'msg_1',
    sender: options.sender ?? from,
    recipient,
    terminal: options.terminal ?? true,
    delivery: { status: options.deliveryStatus ?? 'delivered' }
  }
  if (options.bounceType !== undefined) {
    Object.assign(payload, { bounce: { type: options.bounceType } })
  }
  if (options.rejectionReason !== undefined) {
    Object.assign(payload, { rejection: { reason: options.rejectionReason } })
  }
  return {
    type: options.type ?? 'cf.email.sending.message.delivered',
    source: {
      type: options.sourceType ?? 'email.sending',
      domain: options.sourceDomain ?? 'example.com'
    },
    payload,
    metadata: { eventTimestamp: '2026-09-07T10:00:00.000Z' }
  }
}

function delivery(body: unknown, attempts = 1) {
  return readDelivery(CloudflareEmailSendingEvent, {
    id: 'queue-event-1',
    body,
    attempts
  })
}

function withSeed<A>(program: Effect.Effect<A, unknown, EmailDelivery | Scope.Scope>) {
  return program.pipe(
    Effect.provide(SeedEmailDelivery([{ id: 'usr_1', email: recipient }]))
  )
}

function seedAccepted() {
  return Effect.gen(function* () {
    const emailDelivery = yield* EmailDelivery
    const claim = yield* emailDelivery.claim({
      id: 'email_1',
      purpose: 'notification',
      recipient,
      userId: 'usr_1',
      workspaceId: null
    })
    expect(claim).not.toBeNull()
    if (claim === null) {
      return emailDelivery
    }
    yield* emailDelivery.recordOutcome('email_1', claim.token, {
      status: 'accepted',
      providerMessageId: 'msg_1'
    })
    return emailDelivery
  })
}

describe('processEmailEventMessage', () => {
  it.effect('applies a trusted delivered event through the seed capability', () =>
    withSeed(
      Effect.gen(function* () {
        yield* seedAccepted()
        const outcome = yield* processEmailEventMessage(delivery(event()), {
          CLOUDFLARE_EMAIL_FROM: from
        })
        const record = yield* (yield* EmailDelivery).get('email_1')
        expect(outcome).toBe('ack')
        expect(record?.status).toBe('delivered')
        expect(record?.lastEventId).toBe('evt_1')
      })
    )
  )

  it.effect('acks malformed, untrusted, and unconfigured events', () =>
    withSeed(
      Effect.gen(function* () {
        const malformed = yield* processEmailEventMessage(
          delivery({ type: 'not-an-email-event' }),
          { CLOUDFLARE_EMAIL_FROM: from }
        )
        const wrongType = yield* processEmailEventMessage(
          delivery(event({ sourceType: 'other' })),
          { CLOUDFLARE_EMAIL_FROM: from }
        )
        const wrongDomain = yield* processEmailEventMessage(
          delivery(event({ sourceDomain: 'evil.test' })),
          { CLOUDFLARE_EMAIL_FROM: from }
        )
        const wrongSender = yield* processEmailEventMessage(
          delivery(event({ sender: 'other@example.com' })),
          { CLOUDFLARE_EMAIL_FROM: from }
        )
        const inactive = yield* processEmailEventMessage(delivery(event()), {
          CLOUDFLARE_EMAIL_FROM: undefined
        })
        expect([malformed, wrongType, wrongDomain, wrongSender, inactive]).toEqual([
          'ack',
          'ack',
          'ack',
          'ack',
          'ack'
        ])
      })
    )
  )

  it.effect('maps deferred, bounce, rejection, and complaint lifecycle events', () =>
    withSeed(
      Effect.gen(function* () {
        const cases = [
          ['cf.email.sending.message.deferred', 'delayed'],
          ['cf.email.sending.message.bounced', 'failed'],
          ['cf.email.sending.message.failed', 'failed'],
          ['cf.email.sending.message.rejected', 'suppressed'],
          ['cf.email.sending.message.complained', 'failed']
        ] satisfies ReadonlyArray<readonly [string, string]>
        for (const [type, status] of cases) {
          let rejectionReason: string | undefined
          if (type === 'cf.email.sending.message.rejected') {
            rejectionReason = 'suppressed'
          }
          let options: EventOptions = {
            type,
            eventId: `evt_${type}`,
            messageId: `msg_${type}`,
            deliveryStatus: type.split('.').at(-1) ?? 'unknown',
            terminal: type !== 'cf.email.sending.message.deferred'
          }
          if (rejectionReason !== undefined) {
            options = { ...options, rejectionReason }
          }
          const body = event(options)
          const claimed = yield* (yield* EmailDelivery).claim({
            id: `email_${type}`,
            purpose: 'notification',
            recipient,
            userId: 'usr_1',
            workspaceId: null
          })
          expect(claimed).not.toBeNull()
          if (claimed === null) {
            continue
          }
          yield* (yield* EmailDelivery).recordOutcome(`email_${type}`, claimed.token, {
            status: 'accepted',
            providerMessageId: `msg_${type}`
          })
          const outcome = yield* processEmailEventMessage(delivery(body), {
            CLOUDFLARE_EMAIL_FROM: from
          })
          expect(outcome).toBe('ack')
          expect((yield* (yield* EmailDelivery).get(`email_${type}`))?.status).toBe(
            status
          )
        }
      })
    )
  )

  it.effect(
    'retries an event with no matching send record for queue DLQ handling',
    () =>
      withSeed(
        Effect.gen(function* () {
          const first = yield* processEmailEventMessage(delivery(event(), 1), {
            CLOUDFLARE_EMAIL_FROM: from
          })
          const last = yield* processEmailEventMessage(delivery(event(), 6), {
            CLOUDFLARE_EMAIL_FROM: from
          })
          expect(first).toBe('retry')
          expect(last).toBe('retry')
        })
      )
  )

  it.effect('does not regress a duplicate event and acks it immediately', () =>
    withSeed(
      Effect.gen(function* () {
        yield* seedAccepted()
        const first = yield* processEmailEventMessage(delivery(event(), 1), {
          CLOUDFLARE_EMAIL_FROM: from
        })
        const duplicate = yield* processEmailEventMessage(delivery(event(), 1), {
          CLOUDFLARE_EMAIL_FROM: from
        })
        const record = yield* (yield* EmailDelivery).get('email_1')
        expect(first).toBe('ack')
        expect(duplicate).toBe('ack')
        expect(record?.status).toBe('delivered')
        expect(record?.lastEventId).toBe('evt_1')
      })
    )
  )

  it.effect('lets a later complaint strengthen a prior soft-bounce outcome', () =>
    withSeed(
      Effect.gen(function* () {
        const emailDelivery = yield* EmailDelivery
        const claim = yield* emailDelivery.claim({
          id: 'email_complaint',
          purpose: 'notification',
          recipient,
          userId: 'usr_1',
          workspaceId: null
        })
        expect(claim).not.toBeNull()
        if (claim === null) {
          return
        }
        yield* emailDelivery.recordOutcome('email_complaint', claim.token, {
          status: 'accepted',
          providerMessageId: 'msg_complaint'
        })

        const bounced = yield* processEmailEventMessage(
          delivery(
            event({
              type: 'cf.email.sending.message.bounced',
              eventId: 'evt_soft_bounce',
              messageId: 'msg_complaint',
              bounceType: 'soft'
            })
          ),
          { CLOUDFLARE_EMAIL_FROM: from }
        )
        const complained = yield* processEmailEventMessage(
          delivery(
            event({
              type: 'cf.email.sending.message.complained',
              eventId: 'evt_complaint',
              messageId: 'msg_complaint'
            })
          ),
          { CLOUDFLARE_EMAIL_FROM: from }
        )
        const record = yield* emailDelivery.get('email_complaint')

        expect(bounced).toBe('ack')
        expect(complained).toBe('ack')
        expect(record).toMatchObject({
          status: 'failed',
          reason: 'complaint',
          lastEventId: 'evt_complaint'
        })
      })
    )
  )
})
