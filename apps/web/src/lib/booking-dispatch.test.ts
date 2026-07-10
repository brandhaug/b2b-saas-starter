import { describe, expect, it, vi } from 'vitest'
import {
  dispatchBookingRequest,
  isBookingRequest,
  type BookingServiceBinding
} from './booking-dispatch.ts'

const requestFor = (path: string, traceId = 'trace-from-browser') =>
  new Request(`https://www.example.test${path}`, {
    headers: { 'x-trace-id': traceId }
  })

describe('booking ingress dispatch', () => {
  it.each([
    '/demo-shop/booking',
    '/demo-shop/booking/services',
    '/demo-shop/booking/session/bsn_123/checkout',
    '/_booking/assets/entry.js'
  ])('recognizes public Booking App traffic: %s', (path) => {
    expect(isBookingRequest(new URL(`https://www.example.test${path}`))).toBe(true)
  })

  it.each([
    '/docs/booking',
    '/booking/booking',
    '/demo-shop',
    '/demo-shop/services',
    '/demo-shop/booking-notes',
    '/_booking'
  ])('keeps non-booking Public Site traffic: %s', (path) => {
    expect(isBookingRequest(new URL(`https://www.example.test${path}`))).toBe(false)
  })

  it('preserves the original URL and trace ID when it delegates', async () => {
    const booking: BookingServiceBinding = {
      fetch: vi.fn(async (request: Request) => {
        expect(request.url).toBe(
          'https://www.example.test/demo-shop/booking/services?intent=haircut'
        )
        expect(request.headers.get('x-trace-id')).toBe('trace-through-ingress')
        return new Response('Booking App response', { status: 200 })
      })
    }
    const fallback = vi.fn(async () => new Response('Public Site response'))

    const response = await dispatchBookingRequest(
      new Request(
        'https://www.example.test/demo-shop/booking/services?intent=haircut',
        { headers: { 'x-trace-id': 'trace-through-ingress' } }
      ),
      { BOOKING: booking },
      fallback
    )

    expect(await response.text()).toBe('Booking App response')
    expect(fallback).not.toHaveBeenCalled()
    expect(booking.fetch).toHaveBeenCalledOnce()
  })

  it('does not invoke Booking for reserved slugs or Public Site paths', async () => {
    const booking: BookingServiceBinding = { fetch: vi.fn() }
    const fallback = vi.fn(async () => new Response('Public Site response'))

    const response = await dispatchBookingRequest(
      requestFor('/docs/booking'),
      { BOOKING: booking },
      fallback
    )

    expect(await response.text()).toBe('Public Site response')
    expect(booking.fetch).not.toHaveBeenCalled()
    expect(fallback).toHaveBeenCalledOnce()
  })

  it('returns a branded, traceable 503 when the binding is missing', async () => {
    const response = await dispatchBookingRequest(
      requestFor('/demo-shop/booking', 'trace-booking-unavailable'),
      {},
      async () => new Response('Public Site response')
    )

    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBe('60')
    expect(response.headers.get('x-trace-id')).toBe('trace-booking-unavailable')
    await expect(response.text()).resolves.toContain('Booking temporarily unavailable')
  })

  it('returns the same safe 503 when the service binding fails', async () => {
    const response = await dispatchBookingRequest(
      requestFor('/_booking/assets/entry.js'),
      {
        BOOKING: {
          fetch: vi.fn(async () => {
            throw new Error('service binding is unavailable')
          })
        }
      },
      async () => new Response('Public Site response')
    )

    expect(response.status).toBe(503)
    expect(response.headers.get('x-trace-id')).toBe('trace-from-browser')
  })
})
