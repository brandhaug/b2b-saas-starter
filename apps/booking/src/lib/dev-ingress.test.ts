import { describe, expect, it } from 'vitest'
import { bookingVitePath } from './dev-ingress.ts'

describe('Booking local ingress paths', () => {
  it('maps the public StyleX stylesheet URL to Vite’s root virtual endpoint', () => {
    const target = new URL(
      'http://localhost:3074/_booking/virtual:stylex.css?t=1783705972517'
    )
    target.pathname = bookingVitePath(target.pathname)

    expect(target.pathname).toBe('/virtual:stylex.css')
    expect(target.search).toBe('?t=1783705972517')
  })

  it('keeps Booking asset paths and prefixes merchant-scoped routes', () => {
    expect(bookingVitePath('/_booking/@id/virtual:stylex:runtime')).toBe(
      '/_booking/@id/virtual:stylex:runtime'
    )
    expect(bookingVitePath('/adda/booking')).toBe('/_booking/adda/booking')
  })
})
