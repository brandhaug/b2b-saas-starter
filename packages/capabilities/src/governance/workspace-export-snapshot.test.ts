import { DateTime, Deferred, Effect, Fiber, Layer, Queue } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import { WebhookEndpointId } from '@b2b-saas-starter/db/ids'

import { WebhookEndpoints } from '../developer-platform/webhook-endpoints.ts'
import { SeedLayer } from '../layers.ts'
import { seedWorkspaceRecord } from '../seed-fixture.ts'
import { testWorkspaceContext } from '../workspace-context.ts'
import { collectWorkspaceExportSnapshot } from './workspace-export-snapshot.ts'

describe('collectWorkspaceExportSnapshot — per-endpoint delivery reads', () => {
  it.effect('reads at most four endpoints’ deliveries at once', () =>
    Effect.gen(function* () {
      const webhooks = yield* WebhookEndpoints
      const [template] = yield* webhooks.list
      if (template === undefined) {
        return yield* Effect.die('the seed fixture carries a webhook endpoint')
      }
      const endpoints = Array.from({ length: 20 }, (_, index) => ({
        ...template,
        id: WebhookEndpointId.make(`${template.id}_${index}`)
      }))
      // Every started read waits on the gate, so none can finish and free a
      // slot: once four have started, a fifth can only have started if the
      // fan-out ignores its bound.
      const gate = yield* Deferred.make<undefined>()
      const starts = yield* Queue.unbounded<string>()
      let started = 0
      let inFlight = 0
      let peak = 0
      const gated = WebhookEndpoints.of({
        ...webhooks,
        list: Effect.succeed(endpoints),
        listDeliveries: ({ endpointId }) =>
          Effect.gen(function* () {
            started += 1
            inFlight += 1
            peak = Math.max(peak, inFlight)
            yield* Queue.offer(starts, endpointId)
            yield* Deferred.await(gate)
            inFlight -= 1
            return []
          })
      })
      const collecting = yield* Effect.forkChild(
        collectWorkspaceExportSnapshot({
          exportId: 'exp_bounded',
          generatedAt: DateTime.makeUnsafe(0)
        }).pipe(Effect.provideService(WebhookEndpoints, gated))
      )
      for (let index = 0; index < 4; index += 1) {
        yield* Queue.take(starts)
      }
      yield* Deferred.succeed(gate, undefined)
      const snapshot = yield* Fiber.join(collecting)
      expect(started).toBe(20)
      expect(peak).toBe(4)
      expect(snapshot.webhookEndpoints.map((endpoint) => endpoint.id)).toEqual(
        endpoints.map((endpoint) => endpoint.id)
      )
    }).pipe(
      Effect.provide(Layer.merge(SeedLayer, testWorkspaceContext(seedWorkspaceRecord)))
    )
  )
})
