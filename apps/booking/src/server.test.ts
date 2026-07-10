import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

vi.mock('cloudflare:workers', () => ({
  env: {
    DB: {} as D1Database,
    PUBLIC_SITE_ORIGIN: 'http://localhost:3071',
    CONFIRMATION_CURRENT_KEY_ID: 'test',
    CONFIRMATION_SIGNING_KEYS: '{"test":"test-key"}'
  }
}))

vi.mock('./lib/booking-session-http.ts', () => ({
  handleBookingSessionRequest: () => Effect.succeed(new Response('Booking App reached'))
}))

import worker, { publishBookingWakeUp } from './server.ts'

describe('Booking Worker entry', () => {
  it('uses the local Worker environment when Vite omits the fetch env argument', async () => {
    const response = await worker.fetch(
      new Request('http://localhost:3073/adda/booking')
    )

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('Booking App reached')
  })

  it('keeps committed success visible when the queue wake-up fails', async () => {
    const committed = { outboxId: 'obx_committed', appointmentId: 'apt_committed' }
    const queue = { send: vi.fn().mockRejectedValue(new Error('queue unavailable')) }
    await expect(publishBookingWakeUp(queue, committed)).resolves.toBe(committed)
    expect(queue.send).toHaveBeenCalledWith({ outboxId: 'obx_committed' })
  })
})
