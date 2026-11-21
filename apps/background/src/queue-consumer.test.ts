// oxlint-disable-next-line effect/noNodeBuiltinImport -- loopback server verifies native fetch redirect behavior
import { createServer } from 'node:http'
import { describe, expect, it, vi } from '@effect/vitest'
import { DateTime, Deferred, Effect, Fiber, Queue, Result } from 'effect'
import { HttpClient } from 'effect/http'

import { consumeBatch, consumerInvocation, runInvocation } from './queue-consumer.ts'

describe('consumeBatch', () => {
  it.effect(
    'retains message identity and receiver status in the serialized canonical event',
    () =>
      Effect.gen(function* () {
        const lines: Array<string> = []
        const output = vi
          .spyOn(console, 'log')
          .mockImplementation((line: string) => lines.push(line))
        try {
          yield* Effect.promise(() =>
            runInvocation(
              {},
              consumerInvocation(
                {},
                {
                  event: 'webhook_delivery',
                  delivery: { id: 'message-identity', attempts: 2, kind: 'malformed' },
                  onFailure: 'retry',
                  program: Effect.annotateLogsScoped({ responseStatus: 202 }).pipe(
                    Effect.as('ack' as const)
                  )
                }
              )
            )
          )
          expect(lines).toHaveLength(1)
          // oxlint-disable-next-line effect/noGlobals -- inspect the actual console JSON output
          expect(JSON.parse(lines[0] ?? '')).toMatchObject({
            annotations: {
              messageId: 'message-identity',
              attempts: 2,
              responseStatus: 202
            }
          })
        } finally {
          output.mockRestore()
        }
      })
  )
  it.effect(
    'runs at most six messages at once, the Worker outbound connection limit',
    () => {
      const messages = Array.from(
        { length: 25 },
        (_, index) =>
          ({
            id: `message-${index}`,
            timestamp: DateTime.toDate(DateTime.makeUnsafe(0)),
            body: {},
            attempts: 1,
            ack: vi.fn(),
            retry: vi.fn()
          }) satisfies Message<unknown>
      )
      const batch = {
        queue: 'b2b-saas-starter-webhooks',
        messages,
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
        retryAll: vi.fn(),
        ackAll: vi.fn()
      } satisfies MessageBatch<unknown>
      // Every started message waits on the gate, so none can finish and free a
      // slot: once six have started, a seventh can only have started if the
      // batch ignores the bound.
      const gate = Deferred.makeUnsafe<undefined>()
      let started = 0
      let peak = 0
      let inFlight = 0
      return Effect.gen(function* () {
        const starts = yield* Queue.unbounded<number>()
        function perMessage() {
          return Effect.gen(function* () {
            started += 1
            inFlight += 1
            peak = Math.max(peak, inFlight)
            yield* Queue.offer(starts, started)
            yield* Deferred.await(gate)
            inFlight -= 1
            return 'ack' as const
          })
        }
        const run = yield* Effect.forkChild(
          Effect.tryPromise(() => consumeBatch({}, batch, perMessage))
        )
        for (let index = 0; index < 6; index += 1) {
          yield* Queue.take(starts)
        }
        expect(started).toBe(6)
        yield* Deferred.succeed(gate, undefined)
        yield* Fiber.join(run)
        expect(started).toBe(25)
        expect(peak).toBe(6)
        expect(messages.every((message) => message.ack.mock.calls.length === 1)).toBe(
          true
        )
      })
    }
  )

  it.effect('honors a consumer-provided retry delay', () => {
    const retry = vi.fn()
    const message = {
      id: 'message-1',
      timestamp: DateTime.toDate(DateTime.makeUnsafe(0)),
      body: {},
      attempts: 1,
      ack: vi.fn(),
      retry
    } satisfies Message<unknown>
    const batch = {
      queue: 'test',
      messages: [message],
      metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
      retryAll: vi.fn(),
      ackAll: vi.fn()
    } satisfies MessageBatch<unknown>

    return Effect.tryPromise(() =>
      consumeBatch({}, batch, () => Effect.succeed({ retryAfterSeconds: 3600 }))
    ).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          expect(message.ack).not.toHaveBeenCalled()
          expect(retry).toHaveBeenCalledWith({ delaySeconds: 3600 })
        })
      )
    )
  })

  it.effect('holds every message in the queue while maintenance mode is on', () => {
    const retry = vi.fn()
    const perMessage = vi.fn(() => Effect.succeed<'ack'>('ack'))
    const message = {
      id: 'message-2',
      timestamp: DateTime.toDate(DateTime.makeUnsafe(0)),
      body: {},
      attempts: 1,
      ack: vi.fn(),
      retry
    } satisfies Message<unknown>
    const batch = {
      queue: 'b2b-saas-starter-webhooks',
      messages: [message],
      metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
      retryAll: vi.fn(),
      ackAll: vi.fn()
    } satisfies MessageBatch<unknown>

    return Effect.tryPromise(() =>
      consumeBatch({ MAINTENANCE_MODE: 'true' }, batch, perMessage)
    ).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          // Acking here would discard customer work while an operator restores
          // the shared database, so the batch is neither consumed nor acked.
          expect(perMessage).not.toHaveBeenCalled()
          expect(message.ack).not.toHaveBeenCalled()
          expect(retry).toHaveBeenCalledWith({ delaySeconds: 60 })
        })
      )
    )
  })
})

describe('background HTTP transport', () => {
  it.effect('does not follow a redirect from a provider endpoint', () => {
    let redirectedRequests = 0
    const server = createServer((request, response) => {
      if (request.url === '/redirect') {
        response.writeHead(307, { location: '/target' }).end()
        return
      }
      if (request.url === '/target') {
        redirectedRequests += 1
        response.writeHead(204).end()
      }
    })
    return Effect.acquireUseRelease(
      Effect.promise(
        () =>
          new Promise<typeof server>((resolve, reject) => {
            server.once('error', reject)
            server.listen(0, '127.0.0.1', () => resolve(server))
          })
      ),
      (listeningServer) =>
        Effect.gen(function* () {
          const address = listeningServer.address()
          // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Node's address API returns a string for named pipes
          if (address === null || typeof address === 'string') {
            return yield* Effect.die('test server did not expose a port')
          }
          const result = yield* Effect.promise(() =>
            runInvocation(
              {},
              Effect.gen(function* () {
                const client = yield* HttpClient.HttpClient
                return yield* client.get(`http://127.0.0.1:${address.port}/redirect`)
              }).pipe(Effect.result)
            )
          )
          expect(Result.isSuccess(result)).toBe(true)
          if (Result.isSuccess(result)) {
            expect(result.success.status).toBe(307)
          }
          expect(redirectedRequests).toBe(0)
        }),
      (activeServer) =>
        Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              activeServer.close(() => resolve())
            })
        )
    )
  })
})
