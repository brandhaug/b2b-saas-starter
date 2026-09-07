import {
  nextConsecutiveFailures,
  failureLadderAction,
  type WebhookDeliveryAttemptInput
} from '@b2b-saas-starter/capabilities/developer-platform/webhook-delivery-plan'
import { WebhookEndpoints } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { WebhookQueueMessage } from '@b2b-saas-starter/capabilities/developer-platform/webhook-publisher'
import {
  NotificationFeed,
  type CreateNotificationInput,
  type NotifyWorkspaceOwnersInput
} from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import { WorkspaceSuspensionService } from '@b2b-saas-starter/capabilities/governance/workspace-suspension'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import {
  HttpClient,
  HttpClientResponse,
  type HttpClientRequest
} from 'effect/unstable/http'

import { computeWebhookSignature } from './webhook-signing.ts'
import { processDeadLetterMessage, processWebhookMessage } from './webhook-consumer.ts'
import { readDelivery } from './queue-consumer.ts'

// The delivery state machine (`backoffSeconds`, `classifyResponseStatus`,
// `planDeliveryAttempt`) and the SSRF guard (`validateWebhookUrl`) are pure
// exports of `@b2b-saas-starter/capabilities` — their cases live beside them
// in `webhook-delivery-plan.test.ts` / `webhook-url.test.ts`, not here. What
// this file owns is the worker's orchestration around them.

const message: WebhookQueueMessage = {
  deliveryId: 'whd_qmsg_1',
  endpointId: 'wh_1',
  workspaceId: 'ws_1',
  eventType: 'api_token.created',
  payload: { hello: 'world' }
}

const target = {
  id: 'wh_1',
  url: 'https://example.com/hook',
  signingSecrets: ['whsec_dGVzdF9zZWNyZXQ=']
}

/** Same endpoint mid-rotation: the replaced secret still signs for 24h. */
const rotatingTarget = {
  id: 'wh_1',
  url: 'https://example.com/hook',
  signingSecrets: ['whsec_bmV3X3NlY3JldA==', 'whsec_b2xkX3NlY3JldA==']
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
    listDeliveryAttempts: () => Effect.die('unused in delivery tests'),
    cleanupDeliveryHistory: () => Effect.die('unused in delivery tests'),
    listDeliveries: () => Effect.die('unused in delivery tests'),
    listGlobalDeliveries: () => Effect.die('unused in delivery tests'),
    replayDeliveryAsAdmin: () => Effect.die('unused in delivery tests'),
    isDeliverySettled: () => Effect.succeed(false),
    getDispatchTarget: (endpointId, workspaceId) =>
      Effect.succeed(resolveTarget(dispatchTarget, endpointId, workspaceId)),
    recordDeliveryAttempt: (input) =>
      Effect.sync(() => {
        recorded.push(input)
        streak.current = nextConsecutiveFailures(streak.current, input.status)
        return {
          consecutiveFailures: streak.current,
          recorded: true,
          failureAction: failureLadderAction(streak.current),
          status: input.status
        }
      }),
    recordTerminalDeliveryAttempt: (input) =>
      Effect.sync(() => {
        if (input.workspaceId !== 'ws_1') {
          return {
            deliveryId: input.deliveryId,
            recorded: false,
            failureAction: 'silent',
            consecutiveFailures: streak.current,
            status: input.status
          }
        }
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
          recorded: true,
          failureAction: failureLadderAction(streak.current),
          status: input.status,
          consecutiveFailures: streak.current
        }
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
    prepareWorkspaceOwners: () => Effect.succeed({ writes: [], publish: Effect.void }),
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
          HttpClientResponse.fromWeb(
            request,
            new Response('receiver response', { status })
          )
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
    const captured: CapturedRequest = {}
    const streak: StreakState = { current: startsAtStreak }
    return processWebhookMessage(
      readDelivery(WebhookQueueMessage, { id: messageId, body: input, attempts }),
      'trace-test'
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          stubEndpoints(dispatchTarget, recorded, streak),
          stubFeed(created, ownerNotices),
          stubHttp(status, captured),
          Layer.succeed(WorkspaceSuspensionService)({
            list: Effect.succeed([]),
            get: () => Effect.die('unused'),
            requireAllowed: () => Effect.void,
            transition: () => Effect.die('unused')
          })
        )
      ),
      Effect.map((outcome) => ({
        outcome,
        recorded,
        created,
        ownerNotices,
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
          'webhook-id': 'whd_qmsg_1'
        }
      })
      const headers: Record<string, string | undefined> =
        captured.request?.headers ?? {}
      expect(headers['webhook-id']).toBe('whd_qmsg_1')
      expect(headers['webhook-signature']).toMatch(/^v1,[A-Za-z0-9+/]{43}=$/)
      expect(headers['x-trace-id']).toBe('trace-test')
      // The exact header block the consumer recorded is the one it posted.
      expect(recorded[0]?.requestHeaders?.['webhook-signature']).toBe(
        headers['webhook-signature']
      )
      expect(recorded[0]?.responseBody).toBe('receiver response')
      expect(recorded[0]?.durationMs).toBeGreaterThanOrEqual(0)
      expect(recorded[0]?.failureReason).toBeNull()
    })
  )

  it.effect('dual-signs while a rotated secret is inside its grace window', () =>
    Effect.gen(function* () {
      const { outcome, recorded, captured } = yield* run(rotatingTarget, 200)
      expect(outcome).toBe('ack')
      const headers: Record<string, string | undefined> =
        captured.request?.headers ?? {}
      const header = headers['webhook-signature'] ?? ''
      // Two entries: the current secret signs first, the replaced one second.
      const entries = header.split(' ')
      expect(entries).toHaveLength(2)
      // Recompute both signatures over the exact bytes the request carried.
      const requestBody = captured.request?.body
      expect(requestBody?._tag).toBe('Uint8Array')
      let bodyText = ''
      if (requestBody?._tag === 'Uint8Array') {
        bodyText = new TextDecoder().decode(requestBody.body)
      }
      const timestamp = Number(headers['webhook-timestamp'])
      const expectedFirst = yield* computeWebhookSignature(
        'whsec_bmV3X3NlY3JldA==',
        headers['webhook-id'] ?? '',
        timestamp,
        bodyText
      )
      const expectedSecond = yield* computeWebhookSignature(
        'whsec_b2xkX3NlY3JldA==',
        headers['webhook-id'] ?? '',
        timestamp,
        bodyText
      )
      expect(entries[0]).toBe(`v1,${expectedFirst}`)
      expect(entries[1]).toBe(`v1,${expectedSecond}`)
      // The recorded evidence carries the same dual-signature header.
      expect(recorded[0]?.requestHeaders?.['webhook-signature']).toBe(header)
    })
  )

  it.effect('retries on 5xx and persists the backoff-aligned next attempt', () =>
    Effect.gen(function* () {
      const { outcome, recorded } = yield* run(target, 500, 2)
      expect(outcome).toBe('retry')
      expect(recorded[0]).toMatchObject({
        status: 'failed',
        responseStatus: 500,
        failureReason: 'Receiver returned HTTP 500'
      })
      expect(recorded[0]?.durationMs).toBeGreaterThanOrEqual(0)
      expect(recorded[0]?.nextAttemptAt).toBeTruthy()
    })
  )

  it.effect(
    'uses the producer identity across redeliveries with different platform IDs',
    () =>
      Effect.gen(function* () {
        // Two independent runs stand in for attempt 1 and its redelivery: the
        // envelope id is the identity, so both must persist — and sign — the
        // same deliveryId even though each run is a fresh invocation.
        const firstAttempt = yield* run(target, 500, 1, message, 'qmsg_1')
        const redelivery = yield* run(target, 200, 2, message, 'qmsg_changed')
        expect(firstAttempt.recorded[0]?.id).toBe('whd_qmsg_1')
        expect(redelivery.recorded[0]?.id).toBe('whd_qmsg_1')
        // The signed body carries the same id it persists (same variable in
        // processWebhookMessage), so receiver dedup on the body's deliveryId
        // collapses both attempts.
      })
  )

  it.effect('uses the new identity stamped on a manual replay', () =>
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
    })
  )

  it.effect('climbs the streak on failure and warns the owners at a rung', () =>
    Effect.gen(function* () {
      // The endpoint already failed four deliveries; this attempt's failure
      // lands on the first rung (ADR 0062 addendum's failure ladder).
      const { outcome, streak, ownerNotices } = yield* run(
        target,
        500,
        1,
        message,
        'qmsg_rung',
        4
      )
      expect(outcome).toBe('retry')
      expect(streak).toBe(5)
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
      const { outcome, streak, created, ownerNotices } = yield* run(
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

  it.effect('notifies owners after the capability records the disable threshold', () =>
    Effect.gen(function* () {
      // Nineteen failures already climbed; this attempt is the one that
      // trips the disable rung.
      const { outcome, streak, ownerNotices } = yield* run(
        target,
        500,
        1,
        message,
        'qmsg_disable',
        19
      )
      expect(outcome).toBe('retry')
      expect(streak).toBe(20)
      // The threshold rung also notifies, naming what happened.
      expect(ownerNotices).toHaveLength(1)
      expect(ownerNotices[0]?.title).toBe('Webhook endpoint auto-disabled')
      expect(ownerNotices[0]?.message).toContain('Re-enable')
    })
  )

  it.effect('records a disabled endpoint outcome without dispatching', () =>
    Effect.gen(function* () {
      const { outcome, recorded, captured } = yield* run(null, 200)
      expect(outcome).toBe('ack')
      expect(recorded[0]).toMatchObject({
        status: 'failed_permanent',
        failureReason: 'Endpoint is disabled or no longer available',
        responseStatus: null
      })
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
    'treats a message without a workspaceId as malformed at the queue boundary',
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
    const ownerNotices: Array<NotifyWorkspaceOwnersInput> = []
    const streak: StreakState = { current: startsAtStreak }
    return processDeadLetterMessage(
      readDelivery(WebhookQueueMessage, { id: 'qmsg_dead', body: input, attempts })
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          stubEndpoints(target, recorded, streak),
          stubFeed([], ownerNotices),
          Layer.succeed(WorkspaceSuspensionService)({
            list: Effect.succeed([]),
            get: () => Effect.die('unused'),
            requireAllowed: () => Effect.void,
            transition: () => Effect.die('unused')
          })
        )
      ),
      Effect.map(() => ({ recorded, ownerNotices }))
    )
  }

  it.effect('records a dead_lettered row carrying the audit workspace id', () =>
    Effect.gen(function* () {
      const { recorded } = yield* runDeadLetter(message)
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
    })
  )

  it.effect('notifies owners when a dead letter reaches the disable threshold', () =>
    Effect.gen(function* () {
      // The exhausted message's terminal write is the streak's twentieth
      // failure — the ladder must react on the dead-letter path too.
      const { ownerNotices } = yield* runDeadLetter(message, 4, 19)
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
