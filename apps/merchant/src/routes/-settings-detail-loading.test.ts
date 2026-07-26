import { describe, expect, it, vi } from 'vitest'

const getMerchantPlan = vi.fn(async () => 'solo' as const)

vi.mock('@/lib/server/merchant-catalog.ts', () => ({ getMerchantPlan }))
vi.mock('@/lib/server/merchant-session.ts', () => ({
  requireMerchantSession: vi.fn()
}))

describe('Settings detail loading', () => {
  it('reads the merchant plan only from the Subscription child route', async () => {
    const { Route: settingsRoute } = await import('./settings.tsx')
    const { Route: subscriptionRoute } = await import('./settings.subscription.tsx')

    expect(settingsRoute.options.loader).toBeUndefined()
    expect(subscriptionRoute.options.loader).toEqual(expect.any(Function))

    const loader = subscriptionRoute.options.loader
    if (typeof loader !== 'function') throw new Error('Subscription loader is missing')
    await loader({} as never)

    expect(getMerchantPlan).toHaveBeenCalledOnce()
  })
})
