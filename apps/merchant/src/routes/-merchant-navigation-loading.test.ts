import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireMerchantSession = vi.fn()

vi.mock('@/lib/server/merchant-session.ts', () => ({
  requireMerchantSession
}))

describe('Merchant navigation loading', () => {
  beforeEach(() => requireMerchantSession.mockReset())

  it('keeps root bootstrap work out of beforeLoad so stayed routes can reuse it', async () => {
    const { Route } = await import('./__root.tsx')

    expect(Route.options.beforeLoad).toBeUndefined()
    expect(Route.options.loader).toEqual(expect.any(Function))
    expect(
      typeof Route.options.shouldReload === 'function'
        ? Route.options.shouldReload({ cause: 'stay' } as never)
        : Route.options.shouldReload
    ).toBe(false)
    expect(
      typeof Route.options.shouldReload === 'function'
        ? Route.options.shouldReload({ cause: 'preload' } as never)
        : Route.options.shouldReload
    ).toBe(false)
    expect(
      typeof Route.options.shouldReload === 'function'
        ? Route.options.shouldReload({ cause: 'enter' } as never)
        : Route.options.shouldReload
    ).toBe(true)
  })

  it('does not repeat the navigation session RPC for a date-only change', async () => {
    const { Route } = await import('./appointments.tsx')
    const beforeLoad = Route.options.beforeLoad
    if (!beforeLoad) throw new Error('appointments beforeLoad is missing')

    await beforeLoad({
      cause: 'stay',
      location: { href: '/appointments?date=2026-07-23' }
    } as never)

    expect(requireMerchantSession).not.toHaveBeenCalled()
  })

  it('does not run the navigation session RPC during intent preloading', async () => {
    const { Route } = await import('./appointments.tsx')
    const beforeLoad = Route.options.beforeLoad
    if (!beforeLoad) throw new Error('appointments beforeLoad is missing')

    await beforeLoad({
      cause: 'preload',
      location: { href: '/appointments?date=2026-07-23' }
    } as never)

    expect(requireMerchantSession).not.toHaveBeenCalled()
  })

  it('still verifies the navigation session when entering appointments', async () => {
    const { Route } = await import('./appointments.tsx')
    const beforeLoad = Route.options.beforeLoad
    if (!beforeLoad) throw new Error('appointments beforeLoad is missing')

    await beforeLoad({
      cause: 'enter',
      location: { href: '/appointments?date=2026-07-23' }
    } as never)

    expect(requireMerchantSession).toHaveBeenCalledWith('/appointments?date=2026-07-23')
  })
})
