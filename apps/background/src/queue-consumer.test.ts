import { describe, expect, it, vi } from '@effect/vitest'
import { DateTime, Effect } from 'effect'

import { consumeBatch } from './queue-consumer.ts'

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
      messages: [message]
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
