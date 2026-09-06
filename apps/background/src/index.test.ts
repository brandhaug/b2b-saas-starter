import {
  nextConsecutiveFailures,
  type WebhookDeliveryAttemptInput
} from '@b2b-saas-starter/capabilities/developer-platform/webhook-delivery-plan'
import { WebhookEndpoints } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { WebhookQueueMessage } from '@b2b-saas-starter/capabilities/developer-platform/webhook-publisher'
import {
  NotificationFeed,
  type CreateNotificationInput,
  type NotifyWorkspaceOwnersInput
} from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import {
  HttpClient,
  HttpClientResponse,
  type HttpClientRequest
} from 'effect/unstable/http'

import { signatureHeaderValue, computeWebhookSignature } from './webhook-signing.ts'
import { processDeadLetterMessage, processWebhookMessage } from './webhook-consumer.ts'
import { readDelivery } from './queue-consumer.ts'

// The delivery state machine (`backoffSeconds`, `classifyResponseStatus`,
// `planDeliveryAttempt`) and the SSRF guard (`validateWebhookUrl`) are pure
// exports of `@b2b-saas-starter/capabilities` — their cases live beside them
// in `webhook-delivery-plan.test.ts` / `webhook-url.test.ts`, not here. What
// this file owns is the worker's orchestration around them.

describe('webhook signature', () => {
  it.effect('matches the fixed HMAC-SHA256 vector over "<timestamp>.<body>"', () =>
    Effect.gen(function* () {
      const secret = 'whsec_test'
      const timestamp = 1_700_000_000
      const body =
        '{"deliveryId":"whd_test","eventType":"demo.event","payload":{"hello":"world"}}'
      const signature = yield* computeWebhookSignature(secret, timestamp, body)
      expect(signature).toBe(
        '869b9de1fa743616d6143977e0a770f55f7cfd874cba33d935c1bfb5b481f9b2'
      )
      expect(signatureHeaderValue(timestamp, [signature])).toBe(
        't=1700000000,sha256=869b9de1fa743616d6143977e0a770f55f7cfd874cba33d935c1bfb5b481f9b2'
      )
    })
  )

  it.effect('lists one sha256 entry per active signing secret on the header', () =>
    Effect.gen(function* () {
      const timestamp = 1_700_000_000
      const body = '{"hello":"world"}'
      const signatures = [
        yield* computeWebhookSignature('whsec_new', timestamp, body),
        yield* computeWebhookSignature('whsec_old', timestamp, body)
      ]
      // The rotation-grace shape: `t=` first, then one sha256 per secret, in
      // signing order (current secret first).
      const header = signatureHeaderValue(timestamp, signatures)
      expect(header).toMatch(/^t=1700000000,sha256=[0-9a-f]{64},sha256=[0-9a-f]{64}$/)
      expect(header).toContain(signatures[1])
      expect(signatures[0]).not.toBe(signatures[1])
    })
  )
})

const message: WebhookQueueMessage = {
  endpointId: 'wh_1',
  workspaceId: 'ws_1',
  eventType: 'api_token.created',
  payload: { hello: 'world' }
}

const target = {
  id: 'wh_1',
  url: 'https://example.com/hook',
  signingSecrets: ['whsec_test']
}

/** Same endpoint mid-rotation: the replaced secret still signs for 24h. */
const rotatingTarget = {
  id: 'wh_1',
  url: 'https://example.com/hook',
  signingSecrets: ['whsec_new', 'whsec_old']
}

// Mirrors the Live workspace check: the target only resolves when the
// message's workspaceId matches the endpoint's owning workspace (ws_1).
function resolveTarget(
  dispatchTarget: typeof target | null,
  endpointId: string,
  workspaceId: string
): typeof target | null {
  if (endpointId === dispatchTarget?.id && workspaceId === 'ws_1') {
    return dispatchTarget
  }
  return null
}

/** One auto-disable the consumer asked the capability to run. */
type AutoDisableCall = {
  readonly endpointId: string
  readonly workspaceId: string
  readonly consecutiveFailures: number
}

/**
 * The mutable stand-in for the endpoint's stored streak. The stub moves it
 * with the capability's own pure `nextConsecutiveFailures`, so the counts the
 * consumer reacts to are the counts the real adapter would return. A run
 * starts it at the streak its prior (unstubbed) attempts would have left.
 */
type StreakState = { current: number }

function stubEndpoints(
  dispatchTarget: typeof target | null,
  recorded: Array<WebhookDeliveryAttemptInput>,
  autoDisabled: Array<AutoDisableCall> = [],
  streakInput?: StreakState
): Layer.Layer<WebhookEndpoints> {
  const streak: StreakState = streakInput ?? { current: 0 }
  return Layer.succeed(WebhookEndpoints)({
    list: Effect.die('unused in delivery tests'),
    listPage: () => Effect.die('unused in delivery tests'),
    create: () => Effect.die('unused in delivery tests'),
    rotateSecret: () => Effect.die('unused in delivery tests'),
    update: () => Effect.die('unused in delivery tests'),
    delete: () => Effect.die('unused in delivery tests'),
    replayDelivery: () => Effect.die('unused in delivery tests'),
    sendTestEvent: () => Effect.die('unused in delivery tests'),
    listDeliveries: () => Effect.die('unused in delivery tests'),
    listGlobalDeliveries: () => Effect.die('unused in delivery tests'),
    replayDeliveryAsAdmin: () => Effect.die('unused in delivery tests'),
    getDispatchTarget: (endpointId, workspaceId) =>
      Effect.succeed(resolveTarget(dispatchTarget, endpointId, workspaceId)),
    recordDeliveryAttempt: (input) =>
      Effect.sync(() => {
        recorded.push(input)
        streak.current = nextConsecutiveFailures(streak.current, input.status)
        return { consecutiveFailures: streak.current }
      }),
    recordTerminalDeliveryAttempt: (input) =>
      Effect.sync(() => {
        // The queue message's id resolves the row; the recorded payload keeps
        // the terminal row replayable, exactly like the Live adapter.
        recorded.push({
          id: input.deliveryId,
          ...input,
          responseStatus: null,
          nextAttemptAt: null
        })
        streak.current = nextConsecutiveFailures(streak.current, input.status)
        return {
          deliveryId: input.deliveryId,
          consecutiveFailures: streak.current
        }
      }),
    autoDisableEndpoint: (input) =>
      Effect.sync(() => {
        autoDisabled.push(input)
      })
  })
}

/**
 * The user-facing half of a terminal delivery: the consumer creates one
 * `webhook.delivery_failed` Notification, and the failure ladder's rungs
 * notify the workspace owners. The tests assert on what the consumer asked
 * the feed to persist. Every other feed method is unused here.
 */
function stubFeed(
  created: Array<CreateNotificationInput>,
  ownerNotices: Array<NotifyWorkspaceOwnersInput> = []
): Layer.Layer<NotificationFeed> {
  return Layer.succeed(NotificationFeed)({
    list: Effect.die('unused in delivery tests'),
    listPage: () => Effect.die('unused in delivery tests'),
    unreadCount: Effect.die('unused in delivery tests'),
    markRead: () => Effect.die('unused in delivery tests'),
    notifyUser: () => Effect.die('unused in delivery tests'),
    create: (input) =>
      Effect.sync(() => {
        created.push(input)
        return {
          id: 'not_stub',
          kind: input.kind,
          title: input.title,
          message: input.message,
          createdAt: '2026-08-25T00:00:00.000Z',
          read: false
        }
      }),
    notifyWorkspaceOwners: (input) =>
      Effect.sync(() => {
        ownerNotices.push(input)
      }),
    loadForEmail: () => Effect.die('unused in delivery tests'),
    listDigestCandidates: () => Effect.die('unused in delivery tests'),
    record: () => Effect.die('unused in delivery tests')
  })
}

/**
 * Out-parameter for the stub HTTP client: the delivery request it saw, so a
 * test can assert on the signed headers and body. Absent until a request is
 * actually dispatched.
 */
type CapturedRequest = { request?: HttpClientRequest.HttpClientRequest }

describe('processWebhookMessage', () => {
  function stubHttp(
    status: number,
    captured: CapturedRequest = {}
  ): Layer.Layer<HttpClient.HttpClient> {
    return Layer.succeed(HttpClient.HttpClient)(
      HttpClient.make((request) => {
        captured.request = request
        return Effect.succeed(
          HttpClientResponse.fromWeb(request, new Response(null, { status }))
        )
      })
    )
  }

  // Both consumers surface D1 outages as CapabilityUnavailable, which now
  // simply fails the test under `it.effect` — the stubs never fail, so a
  // failure here is a real signal, not noise.
  function run(
    dispatchTarget: typeof target | null,
    status: number,
    attempts = 1,
    input: unknown = message,
    messageId = 'qmsg_test',
    startsAtStreak = 0
  ) {
    const recorded: Array<WebhookDeliveryAttemptInput> = []
    const created: Array<CreateNotificationInput> = []
    const ownerNotices: Array<NotifyWorkspaceOwnersInput> = []
    const autoDisabled: Array<AutoDisableCall> = []
    const captured: CapturedRequest = {}
    const streak: StreakState = { current: startsAtStreak }
    return processWebhookMessage(
      readDelivery(WebhookQueueMessage, { id: messageId, body: input, attempts }),
      'trace-test'
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          stubEndpoints(dispatchTarget, recorded, autoDisabled, streak),
          stubFeed(created, ownerNotices),
          stubHttp(status, captured)
        )
      ),
      Effect.map((outcome) => ({
        outcome,
        recorded,
        created,
        ownerNotices,
        autoDisabled,
        captured,
        streak: streak.current
      }))
    )
  }

  it.effect('delivers on 2xx, signs the request, and persists a delivered row', () =>
    Effect.gen(function* () {
      const { outcome, recorded, captured } = yield* run(target, 200)
      expect(outcome).toBe('ack')
      expect(recorded).toHaveLength(1)
      expect(recorded[0]).toMatchObject({
        endpointId: 'wh_1',
        eventType: 'api_token.created',
        status: 'delivered',
        responseStatus: 200,
        nextAttemptAt: null,
        // Operator evidence: what was sent...
        payload: { hello: 'world' },
        requestHeaders: {
          'x-b2b-starter-event': 'api_token.created'
        }
      })
      const headers: Record<string, string | undefined> =
        captured.request?.headers ?? {}
      expect(headers['x-b2b-starter-event']).toBe('api_token.created')
      expect(headers['x-b2b-starter-signature']).toMatch(/^t=\d+,sha256=[0-9a-f]{64}$/)
      expect(headers['x-trace-id']).toBe('trace-test')
      // The exact header block the consumer recorded is the one it posted.
      expect(recorded[0]?.requestHeaders?.['x-b2b-starter-signature']).toBe(
        headers['x-b2b-starter-signature']
      )
      // A null response body records the empty string, not a fabricated one.
      expect(recorded[0]?.responseBody).toBe('')
    })
  )

  it.effect('dual-signs while a rotated secret is inside its grace window', () =>
    Effect.gen(function* () {
      const { outcome, recorded, captured } = yield* run(rotatingTarget, 200)
      expect(outcome).toBe('ack')
      const headers: Record<string, string | undefined> =
        captured.request?.headers ?? {}
      const header = headers['x-b2b-starter-signature'] ?? ''
      // Two entries: the current secret signs first, the replaced one second.
      const entries = header.split(',').filter((part) => part.startsWith('sha256='))
      expect(entries).toHaveLength(2)
      // Recompute both signatures over the exact bytes the request carried.
      const requestBody = captured.request?.body
      expect(requestBody?._tag).toBe('Uint8Array')
      let bodyText = ''
      if (requestBody?._tag === 'Uint8Array') {
        bodyText = new TextDecoder().decode(requestBody.body)
      }
      const timestamp = Number(header.match(/^t=(\d+)/)?.[1])
      const expectedFirst = yield* computeWebhookSignature(
        'whsec_new',
        timestamp,
        bodyText
      )
      const expectedSecond = yield* computeWebhookSignature(
        'whsec_old',
        timestamp,
        bodyText
      )
      expect(entries[0]).toBe(`sha256=${expectedFirst}`)
      expect(entries[1]).toBe(`sha256=${expectedSecond}`)
      // The recorded evidence carries the same dual-signature header.
      expect(recorded[0]?.requestHeaders?.['x-b2b-starter-signature']).toBe(header)
    })
  )

  it.effect('retries on 5xx and persists the backoff-aligned next attempt', () =>
    Effect.gen(function* () {
      const { outcome, recorded } = yield* run(target, 500, 2)
      expect(outcome).toBe('retry')
      expect(recorded[0]).toMatchObject({ status: 'failed', responseStatus: 500 })
      expect(recorded[0]?.nextAttemptAt).toBeTruthy()
    })
  )

  it.effect('derives one stable deliveryId per queue message across redeliveries', () =>
    Effect.gen(function* () {
      // Two independent runs stand in for attempt 1 and its redelivery: the
      // envelope id is the identity, so both must persist — and sign — the
      // same deliveryId even though each run is a fresh invocation.
      const firstAttempt = yield* run(target, 500, 1, message, 'qmsg_1')
      const redelivery = yield* run(target, 200, 2, message, 'qmsg_1')
      expect(firstAttempt.recorded[0]?.id).toBe('whd_qmsg_1')
      expect(redelivery.recorded[0]?.id).toBe('whd_qmsg_1')
      // The signed body carries the same id it persists (same variable in
      // processWebhookMessage), so receiver dedup on the body's deliveryId
      // collapses both attempts.
    })
  )

  it.effect('prefers the deliveryId an operator dispatch stamped on the message', () =>
    Effect.gen(function* () {
      // A replay's pending row exists before the message is enqueued; the
      // consumer must resolve that row, not mint a queue-derived one.
      const replayedMessage = { ...message, deliveryId: 'whd_replayed_row' }
      const { recorded } = yield* run(target, 200, 1, replayedMessage, 'qmsg_9')
      expect(recorded[0]?.id).toBe('whd_replayed_row')
      expect(recorded[0]?.status).toBe('delivered')
    })
  )

  it.effect(
    'acks a non-retryable 4xx as failed_permanent with the audit workspace id',
    () =>
      Effect.gen(function* () {
        const { outcome, recorded, created } = yield* run(target, 404)
        expect(outcome).toBe('ack')
        expect(recorded[0]).toMatchObject({
          status: 'failed_permanent',
          responseStatus: 404,
          nextAttemptAt: null,
          // The Live capability scopes the batched audit event with this id.
          workspaceId: 'ws_1'
        })
        // The user-facing half: one workspace-broadcast Notification.
        expect(created).toHaveLength(1)
        expect(created[0]).toMatchObject({
          workspaceId: 'ws_1',
          userId: null,
          kind: 'webhook.delivery_failed'
        })
        expect(created[0]?.message).toContain('https://example.com/hook')
      })
  )

  it.effect('creates no notification for a delivered or retried attempt', () =>
    Effect.gen(function* () {
      const delivered = yield* run(target, 200)
      const retried = yield* run(target, 500)
      expect(delivered.created).toHaveLength(0)
      expect(retried.created).toHaveLength(0)
      // Nor does a fresh failure reach a ladder rung: nothing is escalated.
      expect(delivered.ownerNotices).toHaveLength(0)
      expect(retried.ownerNotices).toHaveLength(0)
      expect(retried.autoDisabled).toHaveLength(0)
    })
  )

  it.effect('climbs the streak on failure and warns the owners at a rung', () =>
    Effect.gen(function* () {
      // The endpoint already failed four deliveries; this attempt's failure
      // lands on the first rung (ADR 0062 addendum's failure ladder).
      const { outcome, streak, ownerNotices, autoDisabled } = yield* run(
        target,
        500,
        1,
        message,
        'qmsg_rung',
        4
      )
      expect(outcome).toBe('retry')
      expect(streak).toBe(5)
      expect(autoDisabled).toHaveLength(0)
      expect(ownerNotices).toHaveLength(1)
      expect(ownerNotices[0]).toMatchObject({
        workspaceId: 'ws_1',
        kind: 'webhook.delivery_failed',
        title: 'Webhook endpoint failing'
      })
      expect(ownerNotices[0]?.message).toContain('https://example.com/hook')
      expect(ownerNotices[0]?.message).toContain('5 deliveries in a row')
    })
  )

  it.effect('resets the streak on a delivered attempt and escalates nothing', () =>
    Effect.gen(function* () {
      // A streak standing at 4 meets a delivered attempt: the reset erases
      // the climb, so the next failure starts from zero, not from 5.
      const { outcome, streak, created, ownerNotices, autoDisabled } = yield* run(
        target,
        200,
        1,
        message,
        'qmsg_reset',
        4
      )
      expect(outcome).toBe('ack')
      expect(streak).toBe(0)
      expect(created).toHaveLength(0)
      expect(ownerNotices).toHaveLength(0)
      expect(autoDisabled).toHaveLength(0)
    })
  )

  it.effect('stays silent between rungs — only 5, 10, and 15 escalate', () =>
    Effect.gen(function* () {
      const sixth = yield* run(target, 500, 1, message, 'qmsg_between', 5)
      expect(sixth.streak).toBe(6)
      expect(sixth.ownerNotices).toHaveLength(0)
      const twelfth = yield* run(target, 500, 1, message, 'qmsg_between_2', 11)
      expect(twelfth.streak).toBe(12)
      expect(twelfth.ownerNotices).toHaveLength(0)
    })
  )

  it.effect('auto-disables the endpoint at the twentieth consecutive failure', () =>
    Effect.gen(function* () {
      // Nineteen failures already climbed; this attempt is the one that
      // trips the disable rung.
      const { outcome, streak, autoDisabled, ownerNotices } = yield* run(
        target,
        500,
        1,
        message,
        'qmsg_disable',
        19
      )
      expect(outcome).toBe('retry')
      expect(streak).toBe(20)
      expect(autoDisabled).toEqual([
        { endpointId: 'wh_1', workspaceId: 'ws_1', consecutiveFailures: 20 }
      ])
      // The threshold rung also notifies, naming what happened.
      expect(ownerNotices).toHaveLength(1)
      expect(ownerNotices[0]?.title).toBe('Webhook endpoint auto-disabled')
      expect(ownerNotices[0]?.message).toContain('Re-enable')
    })
  )

  it.effect('acks a disabled endpoint without recording an attempt', () =>
    Effect.gen(function* () {
      const { outcome, recorded, captured } = yield* run(null, 200)
      expect(outcome).toBe('ack')
      expect(recorded).toHaveLength(0)
      expect(captured.request).toBeUndefined()
    })
  )

  it.effect('acks a malformed queue message without dispatching or recording', () =>
    Effect.gen(function* () {
      const { outcome, recorded, captured } = yield* run(target, 200, 1, {
        endpointId: 42,
        payload: {}
      })
      expect(outcome).toBe('ack')
      expect(recorded).toHaveLength(0)
      expect(captured.request).toBeUndefined()
    })
  )

  it.effect(
    'treats a message without a workspaceId as malformed (legacy in-flight shape)',
    () =>
      Effect.gen(function* () {
        const { outcome, recorded, captured } = yield* run(target, 200, 1, {
          endpointId: 'wh_1',
          eventType: 'api_token.created',
          payload: {}
        })
        expect(outcome).toBe('ack')
        expect(recorded).toHaveLength(0)
        expect(captured.request).toBeUndefined()
      })
  )

  it.effect('acks a cross-workspace message without releasing the signing secret', () =>
    Effect.gen(function* () {
      const { outcome, recorded, captured } = yield* run(target, 200, 1, {
        ...message,
        workspaceId: 'ws_other'
      })
      expect(outcome).toBe('ack')
      expect(recorded).toHaveLength(0)
      expect(captured.request).toBeUndefined()
    })
  )

  it.effect('acks an SSRF-invalid target as failed_permanent without dispatching', () =>
    Effect.gen(function* () {
      const { outcome, recorded, captured } = yield* run(
        { ...target, url: 'https://127.0.0.1/hook' },
        200
      )
      expect(outcome).toBe('ack')
      expect(recorded[0]).toMatchObject({
        status: 'failed_permanent',
        responseStatus: null,
        workspaceId: 'ws_1'
      })
      expect(captured.request).toBeUndefined()
    })
  )
})

describe('processDeadLetterMessage', () => {
  function runDeadLetter(input: unknown, attempts = 4, startsAtStreak = 0) {
    const recorded: Array<WebhookDeliveryAttemptInput> = []
    const autoDisabled: Array<AutoDisableCall> = []
    const ownerNotices: Array<NotifyWorkspaceOwnersInput> = []
    const streak: StreakState = { current: startsAtStreak }
    return processDeadLetterMessage(
      readDelivery(WebhookQueueMessage, { id: 'qmsg_dead', body: input, attempts })
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          stubEndpoints(target, recorded, autoDisabled, streak),
          stubFeed([], ownerNotices)
        )
      ),
      Effect.map(() => ({ recorded, autoDisabled, ownerNotices }))
    )
  }

  it.effect('records a dead_lettered row carrying the audit workspace id', () =>
    Effect.gen(function* () {
      const { recorded, autoDisabled } = yield* runDeadLetter(message)
      expect(recorded).toHaveLength(1)
      expect(recorded[0]).toMatchObject({
        endpointId: 'wh_1',
        workspaceId: 'ws_1',
        eventType: 'api_token.created',
        status: 'dead_lettered',
        attempts: 4,
        responseStatus: null,
        nextAttemptAt: null
      })
      // A first failure on the streak: no rung, no disable.
      expect(autoDisabled).toHaveLength(0)
    })
  )

  it.effect('a dead letter landing on the threshold disables the endpoint', () =>
    Effect.gen(function* () {
      // The exhausted message's terminal write is the streak's twentieth
      // failure — the ladder must react on the dead-letter path too.
      const { autoDisabled, ownerNotices } = yield* runDeadLetter(message, 4, 19)
      expect(autoDisabled).toEqual([
        { endpointId: 'wh_1', workspaceId: 'ws_1', consecutiveFailures: 20 }
      ])
      expect(ownerNotices).toHaveLength(1)
      expect(ownerNotices[0]?.title).toBe('Webhook endpoint auto-disabled')
    })
  )

  it.effect('acks a malformed dead letter without recording', () =>
    Effect.gen(function* () {
      const { recorded } = yield* runDeadLetter({ endpointId: 42 })
      expect(recorded).toHaveLength(0)
    })
  )
})
