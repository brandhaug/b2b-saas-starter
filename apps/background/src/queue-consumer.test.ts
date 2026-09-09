// oxlint-disable-next-line effect/noNodeBuiltinImport -- loopback server verifies native fetch redirect behavior
import { createServer } from 'node:http'
import { describe, expect, it, vi } from '@effect/vitest'
import { DateTime, Effect, Result } from 'effect'
import { HttpClient } from 'effect/unstable/http'

import { consumeBatch, runInvocation } from './queue-consumer.ts'

describe('consumeBatch', () => {
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
      Effect.tryPromise({
        try: () =>
          new Promise<typeof server>((resolve, reject) => {
            server.once('error', reject)
            server.listen(0, '127.0.0.1', () => resolve(server))
          }),
        catch: () => new Error('test server failed to listen')
      }),
      (listeningServer) =>
        Effect.gen(function* () {
          const address = listeningServer.address()
          // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Node's address API returns a string for named pipes
          if (address === null || typeof address === 'string') {
            return yield* Effect.fail(new Error('test server did not expose a port'))
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
