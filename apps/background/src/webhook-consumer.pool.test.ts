import { backoffSeconds } from '@b2b-saas-starter/capabilities/developer-platform/webhook-delivery-plan'
import { type WebhookQueueMessage } from '@b2b-saas-starter/capabilities/developer-platform/webhook-publisher'
import {
  webhookDeadLetterQueueName,
  webhookQueueName
} from '../../../infra/bindings.ts'
import { DateTime, Effect, Schema } from 'effect'
import { Webhook } from 'standardwebhooks'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test'

import {
  applyPoolMigrations,
  consume,
  db,
  row,
  rows,
  type PoolRow
} from './test-pool.ts'

// The queue-runtime half of the webhook consumer, exercised inside workerd
// through `@cloudflare/vitest-pool-workers`: real D1 (the committed
// migrations), the real batch loop in `queue-consumer.ts`, and real
// `ack`/`retry` calls — asserted with `getQueueResult()` against what the
// runtime actually did with each message. Only the receiver endpoint is
// stubbed: the outbound delivery POST is the one genuinely external thing on
// this path. The decision logic itself (`classifyResponseStatus`,
// `planDeliveryAttempt`) keeps its cases beside the capability, and the
// fake-based suites in `index.test.ts` stay the orchestration tests. No
// async functions on purpose — the Effect lint rules ban them, so promise
// steps ride `Effect.promise` inside `Effect.runPromise`, like the live
// suites in `packages/auth`.

const WORKSPACE_ID = 'ws_pool'
const ENDPOINT_ID = 'wh_pool'
const ENDPOINT_URL = 'https://receiver.example.test/hook'
const SIGNING_SECRET = 'whsec_cG9vbF90ZXN0X3NlY3JldA=='

/** A `mode: 'json'` text column, parsed; a null column stays null. */
const JsonColumn = Schema.NullOr(Schema.fromJsonString(Schema.Json))
const readJsonColumn = Schema.decodeUnknownSync(JsonColumn)

/** One outbound delivery the consumer dispatched, as the receiver saw it. */
type OutboundDelivery = {
  readonly url: string
  readonly body: string
  readonly headers: Record<string, string>
}

const outbound: Array<OutboundDelivery> = []

// What the stubbed receiver answers with — or throws on, for a network
// failure. Swapped per test; the fetch stub itself stays one function for
// the whole file, because the isolate's Effect runtime resolves
// `globalThis.fetch` once into its `Fetch` reference (`Context.Reference`
// default) and then keeps using that value, so re-stubbing per test would
// leave the consumer posting through the first test's stub.
let answer: (delivery: OutboundDelivery) => Response = okAnswer

function okAnswer(): Response {
  return new Response('ok', { status: 200 })
}

function stubbedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init)
  return request.text().then((body) => {
    const delivery = {
      url: request.url,
      body,
      headers: Object.fromEntries(request.headers)
    }
    outbound.push(delivery)
    // An `answer` that throws rejects this promise — a network failure.
    return answer(delivery)
  })
}

/** Points the stubbed receiver at a new answer. */
function stubReceiver(respond: (delivery: OutboundDelivery) => Response): void {
  answer = respond
}

/** Simulates a network failure: the POST never gets a response at all. */
function dropConnection(): void {
  answer = () => {
    throw new Error('pool: connection reset')
  }
}

/** One webhook queue message for the fixture endpoint. */
function webhookMessage(
  id: string,
  attempts = 1
): ServiceBindingQueueMessage<WebhookQueueMessage> {
  return {
    id,
    // The platform's message shape carries a plain Date; `DateTime` has no
    // place in a value vitest serializes into the batch.
    // oxlint-disable-next-line effect/noGlobals -- platform message field, not application time
    timestamp: new Date(1000),
    attempts,
    body: {
      deliveryId: `whd_${id}`,
      endpointId: ENDPOINT_ID,
      workspaceId: WORKSPACE_ID,
      eventType: 'api_token.created',
      payload: { hello: 'world' }
    }
  }
}

/** Persist the producer's pending delivery before the worker receives its message. */
function seedDelivery(messageId: string): Effect.Effect<void> {
  return Effect.promise(() =>
    db()
      .prepare(
        `insert into webhook_deliveries
          (id, endpoint_id, event_type, status, attempts, payload)
         values (?, ?, 'api_token.created', 'pending', 0, '{"hello":"world"}')`
      )
      .bind(`whd_${messageId}`, ENDPOINT_ID)
      .run()
  ).pipe(Effect.asVoid)
}

/** Clears the tables the consumer writes and reseeds one dispatchable endpoint. */
function seedEndpoint(): Promise<void> {
  return db()
    .batch([
      db().prepare('delete from webhook_deliveries'),
      db().prepare('delete from audit_events'),
      db().prepare('delete from notifications'),
      db().prepare('delete from webhook_endpoints'),
      db().prepare('delete from workspaces'),
      db()
        .prepare('insert into workspaces (id, name, slug) values (?, ?, ?)')
        .bind(WORKSPACE_ID, 'Pool Tests', 'pool-tests'),
      db()
        .prepare(
          `insert into webhook_endpoints
           (id, workspace_id, url, signing_secret, events, created_at)
         values (?, ?, ?, ?, ?, ?)`
        )
        .bind(
          ENDPOINT_ID,
          WORKSPACE_ID,
          ENDPOINT_URL,
          SIGNING_SECRET,
          '["api_token.created"]',
          '2026-09-06T00:00:00.000Z'
        )
    ])
    .then(() => undefined)
}

/**
 * The retry delay the batch loop handed the queue, read off the row the
 * attempt wrote: `next_attempt_at` derives from the same `backoffSeconds`
 * `message.retry` was called with, so it lands one backoff away from now.
 * (`getQueueResult` does not surface the per-message delay itself.)
 */
function assertBackoffAligned(
  attempt: PoolRow | null,
  attempts: number
): Effect.Effect<void> {
  const nextAttemptAt = Date.parse(String(attempt?.next_attempt_at))
  return Effect.gen(function* () {
    const now = DateTime.toEpochMillis(yield* DateTime.now)
    expect(nextAttemptAt).toBeGreaterThan(now + (backoffSeconds(attempts) - 5) * 1000)
    expect(nextAttemptAt).toBeLessThan(now + (backoffSeconds(attempts) + 5) * 1000)
  })
}

const realFetch = globalThis.fetch

describe('webhook consumer (workers pool)', () => {
  // The fetch stub goes in before anything can dispatch (the runtime's Fetch
  // reference keeps the first value it resolves), and migrations run once per
  // file (see `applyPoolMigrations`).
  // oxlint-disable-next-line effect/noTestLifecycleHooks -- owns the pool's fetch stub and D1 schema
  beforeAll(() => {
    globalThis.fetch = stubbedFetch
    return applyPoolMigrations()
  })
  // oxlint-disable-next-line effect/noTestLifecycleHooks -- resets D1 and the receiver stub between outcomes
  beforeEach(() => {
    outbound.length = 0
    answer = okAnswer
    return seedEndpoint()
  })
  // oxlint-disable-next-line effect/noTestLifecycleHooks -- restores the isolate's fetch
  afterAll(() => {
    globalThis.fetch = realFetch
  })

  it('acks a successful delivery and records the delivered attempt row', () =>
    // oxlint-disable-next-line starter/no-run-promise-in-tests -- promise-interop port: bridges vitest-pool-workers createMessageBatch/getQueueResult into Effect
    Effect.runPromise(
      Effect.gen(function* () {
        yield* seedDelivery('qmsg_ok')
        stubReceiver(okAnswer)
        const result = yield* Effect.promise(() =>
          consume(webhookQueueName, [webhookMessage('qmsg_ok')])
        )

        // The runtime explicitly acked the message — per-message, with no
        // batch-level ops riding along.
        expect(result.ackAll).toBe(false)
        expect(result.retryBatch.retry).toBe(false)
        expect(result.explicitAcks).toStrictEqual(['qmsg_ok'])
        expect(result.retryMessages).toStrictEqual([])
        // ...and the acked attempt is the row D1 holds.
        const delivery = yield* Effect.promise(() =>
          row('select * from webhook_deliveries where id = ?', 'whd_qmsg_ok')
        )
        expect(delivery?.endpoint_id).toBe(ENDPOINT_ID)
        expect(delivery?.event_type).toBe('api_token.created')
        expect(delivery?.status).toBe('delivered')
        expect(delivery?.attempts).toBe(1)
        expect(delivery?.response_status).toBe(200)
        expect(delivery?.next_attempt_at).toBeNull()
        expect(readJsonColumn(delivery?.payload)).toEqual({ hello: 'world' })
        // The POST the runtime delivered was the signed one for that row.
        expect(outbound).toHaveLength(1)
        expect(outbound[0]?.url).toBe(ENDPOINT_URL)
        const posted = outbound[0]
        if (!posted) {
          throw new Error('Receiver did not receive the webhook')
        }
        expect(
          new Webhook(SIGNING_SECRET).verify(posted.body, posted.headers)
        ).toMatchObject({
          deliveryId: 'whd_qmsg_ok',
          payload: { hello: 'world' }
        })
        expect(outbound[0]?.headers['webhook-id']).toBe('whd_qmsg_ok')
        expect(outbound[0]?.headers['webhook-signature']).toMatch(
          /^v1,[A-Za-z0-9+/]{43}=$/
        )
        expect(readJsonColumn(delivery?.request_headers)).toMatchObject({
          'webhook-signature': outbound[0]?.headers['webhook-signature']
        })
        expect(readJsonColumn(outbound[0]?.body)).toMatchObject({
          deliveryId: 'whd_qmsg_ok'
        })
        // Delivered is not terminal: no audit event, no notification.
        expect(
          yield* Effect.promise(() => rows('select * from audit_events'))
        ).toStrictEqual([])
        expect(
          yield* Effect.promise(() => rows('select * from notifications'))
        ).toStrictEqual([])
      })
    ))

  it('settles a queued webhook during suspension and never replays it after recovery', () =>
    // oxlint-disable-next-line starter/no-run-promise-in-tests -- promise-interop port
    Effect.runPromise(
      Effect.gen(function* () {
        yield* seedDelivery('qmsg_suspended')
        yield* Effect.promise(() =>
          db()
            .prepare(
              "update workspaces set suspensionStatus = 'suspended' where id = ?"
            )
            .bind(WORKSPACE_ID)
            .run()
        )
        const suspended = yield* Effect.promise(() =>
          consume(webhookQueueName, [webhookMessage('qmsg_suspended')])
        )
        expect(suspended.retryBatch.retry).toBe(false)
        expect(outbound).toHaveLength(0)
        const terminal = yield* Effect.promise(() =>
          row('select * from webhook_deliveries where id = ?', 'whd_qmsg_suspended')
        )
        expect(terminal?.status).toBe('failed_permanent')
        const attempt = yield* Effect.promise(() =>
          row(
            'select * from webhook_delivery_attempts where delivery_id = ?',
            'whd_qmsg_suspended'
          )
        )
        expect(attempt?.failure_reason).toBe('workspace_suspended')

        yield* Effect.promise(() =>
          db()
            .prepare("update workspaces set suspensionStatus = 'active' where id = ?")
            .bind(WORKSPACE_ID)
            .run()
        )
        yield* Effect.promise(() =>
          consume(webhookQueueName, [webhookMessage('qmsg_suspended')])
        )
        expect(outbound).toHaveLength(0)
      })
    ))

  it('retries a 5xx with the backoff delay and records the failed attempt', () =>
    // oxlint-disable-next-line starter/no-run-promise-in-tests -- promise-interop port: bridges vitest-pool-workers createMessageBatch/getQueueResult into Effect
    Effect.runPromise(
      Effect.gen(function* () {
        yield* seedDelivery('qmsg_retry')
        stubReceiver(() => new Response('boom', { status: 500 }))
        const result = yield* Effect.promise(() =>
          consume(webhookQueueName, [webhookMessage('qmsg_retry', 2)])
        )
        // Not acked: the message rides the queue's backoff.
        expect(result.explicitAcks).toStrictEqual([])
        expect(result.retryMessages).toStrictEqual([{ msgId: 'qmsg_retry' }])
        const delivery = yield* Effect.promise(() =>
          row('select * from webhook_deliveries where id = ?', 'whd_qmsg_retry')
        )
        expect(delivery?.status).toBe('failed')
        expect(delivery?.attempts).toBe(2)
        expect(delivery?.response_status).toBe(500)
        yield* assertBackoffAligned(delivery, 2)
        // Retryable is not terminal: no audit event yet.
        expect(
          yield* Effect.promise(() => rows('select * from audit_events'))
        ).toStrictEqual([])
      })
    ))

  it('retries a network failure with no response status to record', () =>
    // oxlint-disable-next-line starter/no-run-promise-in-tests -- promise-interop port: bridges vitest-pool-workers createMessageBatch/getQueueResult into Effect
    Effect.runPromise(
      Effect.gen(function* () {
        yield* seedDelivery('qmsg_net')
        dropConnection()
        const result = yield* Effect.promise(() =>
          consume(webhookQueueName, [webhookMessage('qmsg_net')])
        )
        expect(result.explicitAcks).toStrictEqual([])
        expect(result.retryMessages).toStrictEqual([{ msgId: 'qmsg_net' }])
        const delivery = yield* Effect.promise(() =>
          row('select * from webhook_deliveries where id = ?', 'whd_qmsg_net')
        )
        expect(delivery?.status).toBe('failed')
        expect(delivery?.attempts).toBe(1)
        // No HTTP response happened, so none is persisted.
        expect(delivery?.response_status).toBeNull()
        yield* assertBackoffAligned(delivery, 1)
      })
    ))

  it('acks a 4xx explicitly and lands the delivery row failed_permanent', () =>
    // oxlint-disable-next-line starter/no-run-promise-in-tests -- promise-interop port: bridges vitest-pool-workers createMessageBatch/getQueueResult into Effect
    Effect.runPromise(
      Effect.gen(function* () {
        yield* seedDelivery('qmsg_4xx')
        stubReceiver(() => new Response('not found', { status: 404 }))
        const result = yield* Effect.promise(() =>
          consume(webhookQueueName, [webhookMessage('qmsg_4xx')])
        )
        // A permanent failure is still an explicit ack — the queue must not
        // redeliver it.
        expect(result.explicitAcks).toStrictEqual(['qmsg_4xx'])
        expect(result.retryMessages).toStrictEqual([])
        const delivery = yield* Effect.promise(() =>
          row('select * from webhook_deliveries where id = ?', 'whd_qmsg_4xx')
        )
        expect(delivery?.status).toBe('failed_permanent')
        expect(delivery?.attempts).toBe(1)
        expect(delivery?.response_status).toBe(404)
        expect(delivery?.next_attempt_at).toBeNull()
        // The terminal row batches its audit event with the attempt.
        const audit = yield* Effect.promise(() =>
          rows(
            'select * from audit_events where event_type = ?',
            'webhook.delivery_failed'
          )
        )
        expect(audit).toHaveLength(1)
        expect(audit[0]?.workspace_id).toBe(WORKSPACE_ID)
        expect(audit[0]?.actor_user_id).toBeNull()
        expect(audit[0]?.target_type).toBe('webhook_endpoint')
        expect(audit[0]?.target_id).toBe(ENDPOINT_ID)
        expect(readJsonColumn(audit[0]?.metadata)).toMatchObject({
          deliveryId: 'whd_qmsg_4xx',
          eventType: 'api_token.created',
          queueAttempts: 1
        })
        // And tells the workspace: one broadcast notification.
        const notified = yield* Effect.promise(() =>
          rows('select * from notifications where kind = ?', 'webhook.delivery_failed')
        )
        expect(notified).toHaveLength(1)
        expect(notified[0]?.workspace_id).toBe(WORKSPACE_ID)
        expect(notified[0]?.user_id).toBeNull()
      })
    ))

  it('acks a dead letter after recording the terminal dead_lettered row', () =>
    // oxlint-disable-next-line starter/no-run-promise-in-tests -- promise-interop port: bridges vitest-pool-workers createMessageBatch/getQueueResult into Effect
    Effect.runPromise(
      Effect.gen(function* () {
        yield* seedDelivery('qmsg_dead')
        stubReceiver(okAnswer)
        // A message that exhausted the primary queue's retries: the DLQ
        // consumer only records evidence, it never dispatches.
        const result = yield* Effect.promise(() =>
          consume(webhookDeadLetterQueueName, [webhookMessage('qmsg_dead', 7)])
        )
        expect(result.explicitAcks).toStrictEqual(['qmsg_dead'])
        expect(result.retryMessages).toStrictEqual([])
        expect(outbound).toHaveLength(0)
        const terminal = yield* Effect.promise(() =>
          rows('select * from webhook_deliveries where status = ?', 'dead_lettered')
        )
        expect(terminal).toHaveLength(1)
        expect(terminal[0]?.id).toBe('whd_qmsg_dead')
        expect(terminal[0]?.endpoint_id).toBe(ENDPOINT_ID)
        expect(terminal[0]?.event_type).toBe('api_token.created')
        expect(terminal[0]?.attempts).toBe(7)
        expect(terminal[0]?.response_status).toBeNull()
        expect(terminal[0]?.next_attempt_at).toBeNull()
        expect(readJsonColumn(terminal[0]?.payload)).toEqual({ hello: 'world' })
        const audit = yield* Effect.promise(() =>
          rows(
            'select * from audit_events where event_type = ?',
            'webhook.delivery_dead_lettered'
          )
        )
        expect(audit).toHaveLength(1)
        expect(audit[0]?.workspace_id).toBe(WORKSPACE_ID)
        expect(audit[0]?.target_id).toBe(ENDPOINT_ID)
        const notified = yield* Effect.promise(() =>
          rows('select * from notifications where kind = ?', 'webhook.delivery_failed')
        )
        expect(notified).toHaveLength(1)
        expect(notified[0]?.workspace_id).toBe(WORKSPACE_ID)
        expect(notified[0]?.user_id).toBeNull()
      })
    ))

  it('preserves failures before success and ignores late duplicate results', () =>
    // oxlint-disable-next-line starter/no-run-promise-in-tests -- worker queue/D1 promise boundary
    Effect.runPromise(
      Effect.gen(function* () {
        yield* seedDelivery('history')
        stubReceiver(() => new Response('retry later', { status: 503 }))
        yield* Effect.promise(() =>
          consume(webhookQueueName, [webhookMessage('history', 1)])
        )
        stubReceiver(okAnswer)
        yield* Effect.promise(() =>
          consume(webhookQueueName, [webhookMessage('history', 2)])
        )
        stubReceiver(() => new Response('late failure', { status: 503 }))
        const late = yield* Effect.promise(() =>
          consume(webhookQueueName, [webhookMessage('history', 1)])
        )
        expect(late.explicitAcks).toEqual(['history'])
        const attempts = yield* Effect.promise(() =>
          rows(
            'select * from webhook_delivery_attempts where delivery_id = ? order by attempts',
            'whd_history'
          )
        )
        expect(attempts).toHaveLength(2)
        expect(attempts[0]?.status).toBe('failed')
        expect(attempts[0]?.response_body).toBe('retry later')
        expect(attempts[0]?.failure_reason).toBe('Receiver returned HTTP 503')
        expect(attempts[0]?.duration_ms).toBeTypeOf('number')
        expect(attempts[1]?.status).toBe('delivered')
        const summary = yield* Effect.promise(() =>
          row('select * from webhook_deliveries where id = ?', 'whd_history')
        )
        expect(summary?.status).toBe('delivered')
        expect(summary?.attempts).toBe(2)
        const endpoint = yield* Effect.promise(() =>
          row(
            'select consecutive_failures from webhook_endpoints where id = ?',
            ENDPOINT_ID
          )
        )
        expect(endpoint?.consecutive_failures).toBe(0)
      })
    ))

  it('records one terminal audit and notification for concurrent duplicate processing', () =>
    // oxlint-disable-next-line starter/no-run-promise-in-tests -- worker queue/D1 promise boundary
    Effect.runPromise(
      Effect.gen(function* () {
        yield* seedDelivery('duplicate')
        stubReceiver(() => new Response('rejected', { status: 400 }))
        yield* Effect.promise(() =>
          Promise.all([
            consume(webhookQueueName, [webhookMessage('duplicate', 1)]),
            consume(webhookQueueName, [webhookMessage('duplicate', 1)])
          ])
        )
        expect(
          yield* Effect.promise(() =>
            rows(
              'select * from webhook_delivery_attempts where delivery_id = ?',
              'whd_duplicate'
            )
          )
        ).toHaveLength(1)
        expect(
          yield* Effect.promise(() =>
            rows(
              'select * from audit_events where event_type = ?',
              'webhook.delivery_failed'
            )
          )
        ).toHaveLength(1)
        expect(
          yield* Effect.promise(() =>
            rows(
              'select * from notifications where kind = ?',
              'webhook.delivery_failed'
            )
          )
        ).toHaveLength(1)
        const endpoint = yield* Effect.promise(() =>
          row(
            'select consecutive_failures from webhook_endpoints where id = ?',
            ENDPOINT_ID
          )
        )
        expect(endpoint?.consecutive_failures).toBe(1)
      })
    ))
})
