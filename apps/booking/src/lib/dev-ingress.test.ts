import { describe, expect, it } from 'vitest'
import { bookingProxyRequest, bookingVitePath } from './dev-ingress.ts'

describe('Booking local ingress paths', () => {
  it('maps the public StyleX stylesheet URL to Vite’s root virtual endpoint', () => {
    const target = new URL(
      'http://localhost:3074/_booking/virtual:stylex.css?t=1783705972517'
    )
    target.pathname = bookingVitePath(target.pathname)

    expect(target.pathname).toBe('/virtual:stylex.css')
    expect(target.search).toBe('?t=1783705972517')
    expect(bookingVitePath('/virtual:stylex.css')).toBe('/virtual:stylex.css')
  })

  it('keeps Booking asset paths and merchant-scoped routes stable', () => {
    expect(bookingVitePath('/_booking/@id/virtual:stylex:runtime')).toBe(
      '/_booking/@id/virtual:stylex:runtime'
    )
    expect(bookingVitePath('/adda/booking')).toBe('/adda/booking')
  })

  it('buffers mutation bodies before forwarding them to Vite', async () => {
    const forwarded = await bookingProxyRequest(
      new Request('http://localhost:3073/adda/booking/session/bsn_one/services', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ primaryServiceId: 'svc_one' })
      }),
      new URL('http://localhost:3074/adda/booking/session/bsn_one/services')
    )

    expect(forwarded.redirect).toBe('manual')
    await expect(forwarded.json()).resolves.toEqual({
      primaryServiceId: 'svc_one'
    })
  })
})
