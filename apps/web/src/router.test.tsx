import { describe, expect, it } from 'vitest'
import { getRouter } from './router.tsx'

describe('Web router navigation', () => {
  it('restores scroll position when returning from Booking', () => {
    const router = getRouter()
    expect(router.options.scrollRestoration).toBe(true)
  })
})
