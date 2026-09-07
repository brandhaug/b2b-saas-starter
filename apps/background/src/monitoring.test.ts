import { describe, expect, it } from '@effect/vitest'
import { vi } from 'vite-plus/test'
import { DateTime, Effect } from 'effect'
import { consumeBatch, type DeliveryOutcome } from './queue-consumer.ts'
import { exhaustedQueueDelivery } from './monitoring.ts'

describe('queue exhaustion policy', () => {
  it('does not treat bounded notification retry work as exhausted after six attempts', () => {
    expect(
      exhaustedQueueDelivery('b2b-saas-starter-notification-emails', 7, true)
    ).toBe(false)
    expect(
      exhaustedQueueDelivery('b2b-saas-starter-notification-emails', 101, true)
    ).toBe(true)
  })

  it('recognizes isolated stages, exhausted exports and dead letters', () => {
    expect(
      exhaustedQueueDelivery(
        'b2b-saas-starter-recovery-drill-workspace-exports',
        4,
        true
      )
    ).toBe(true)
    expect(exhaustedQueueDelivery('b2b-saas-starter-billing-dlq', 1, false)).toBe(true)
    expect(exhaustedQueueDelivery('b2b-saas-starter-webhooks', 7, false)).toBe(false)
  })
})

it.effect(
  'maintenance retains messages without running business work and permits processing after reopening',
  () =>
    Effect.gen(function* () {
      const message = {
        id: 'drill',
        body: {},
        attempts: 1,
        timestamp: DateTime.toDateUtc(DateTime.makeUnsafe(0)),
        ack: vi.fn(),
        retry: vi.fn()
      }
      const batch = {
        queue: 'b2b-saas-starter-webhooks',
        metadata: { metrics: { backlogCount: 1, backlogBytes: 2 } },
        messages: [message],
        ackAll: vi.fn(),
        retryAll: vi.fn()
      }
      const work = vi.fn(() => Effect.succeed<DeliveryOutcome>('ack'))
      yield* Effect.promise(() =>
        consumeBatch({ MAINTENANCE_MODE: 'true' }, batch, work)
      )
      expect(work).not.toHaveBeenCalled()
      expect(message.ack).not.toHaveBeenCalled()
      expect(message.retry).toHaveBeenCalledOnce()
      yield* Effect.promise(() => consumeBatch({}, batch, work))
      expect(message.ack).toHaveBeenCalledOnce()
    })
)
