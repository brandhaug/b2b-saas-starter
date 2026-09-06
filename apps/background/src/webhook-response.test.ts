import { describe, expect, it } from '@effect/vitest'
import { Deferred, Effect, Fiber, Result } from 'effect'
import { TestClock } from 'effect/testing'
import { HttpClientRequest, HttpClientResponse } from 'effect/unstable/http'

import { readWebhookResponse } from './webhook-response.ts'

describe('webhook response evidence', () => {
  it.effect('retains a bounded prefix and stops an unfinished receiver stream', () =>
    Effect.gen(function* () {
      let cancelled = false
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('x'.repeat(10_000)))
        },
        cancel() {
          cancelled = true
        }
      })
      const response = HttpClientResponse.fromWeb(
        HttpClientRequest.get('https://receiver.example/hook'),
        new Response(body)
      )
      const evidence = yield* readWebhookResponse(response)
      expect(evidence).toBe(`${'x'.repeat(2048)}… [truncated]`)
      expect(cancelled).toBe(true)
    })
  )

  it.effect('preserves a complete UTF-8 response', () =>
    Effect.gen(function* () {
      const response = HttpClientResponse.fromWeb(
        HttpClientRequest.get('https://receiver.example/hook'),
        new Response('Accepted ✓')
      )
      expect(yield* readWebhookResponse(response)).toBe('Accepted ✓')
    })
  )

  it.effect('times out an idle receiver after two seconds and cancels its stream', () =>
    Effect.gen(function* () {
      const reading = yield* Deferred.make<undefined>()
      const completed = yield* Deferred.make<undefined>()
      let cancelled = false
      const body = new ReadableStream<Uint8Array>(
        {
          pull() {
            // Native stream callback signals that the response reader is waiting.
            Deferred.doneUnsafe(reading, Effect.succeed(undefined))
          },
          cancel() {
            cancelled = true
          }
        },
        { highWaterMark: 0 }
      )
      const response = HttpClientResponse.fromWeb(
        HttpClientRequest.get('https://receiver.example/hook'),
        new Response(body)
      )
      const fiber = yield* readWebhookResponse(response).pipe(
        Effect.result,
        Effect.tap(() => Deferred.succeed(completed, undefined)),
        Effect.forkChild
      )
      yield* Deferred.await(reading)
      yield* TestClock.adjust('1999 millis')
      expect(yield* Deferred.isDone(completed)).toBe(false)
      yield* TestClock.adjust('1 millis')
      const outcome = yield* Fiber.join(fiber)
      expect(Result.isFailure(outcome)).toBe(true)
      if (Result.isFailure(outcome)) {
        expect(outcome.failure._tag).toBe('TimeoutError')
      }
      expect(cancelled).toBe(true)
    })
  )

  it.effect('keeps an exact 2048-byte response without a truncation marker', () =>
    Effect.gen(function* () {
      const text = 'é'.repeat(1024)
      const response = HttpClientResponse.fromWeb(
        HttpClientRequest.get('https://receiver.example/hook'),
        new Response(text)
      )
      expect(yield* readWebhookResponse(response)).toBe(text)
    })
  )

  it.effect('marks a UTF-8 character cut by the byte limit as truncated evidence', () =>
    Effect.gen(function* () {
      const response = HttpClientResponse.fromWeb(
        HttpClientRequest.get('https://receiver.example/hook'),
        new Response(`${'a'.repeat(2047)}🌍 trailing receiver text`)
      )
      expect(yield* readWebhookResponse(response)).toBe(
        `${'a'.repeat(2047)}�… [truncated]`
      )
    })
  )
})
