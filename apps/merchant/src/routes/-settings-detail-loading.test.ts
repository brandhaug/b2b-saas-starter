import { describe, expect, it, vi } from 'vitest'

const getOwnerBilling = vi.fn(async () => ({
  plan: 'solo' as const,
  access: 'trialing' as const,
  interval: 'monthly' as const,
  revision: 1
}))

vi.mock('@/lib/server/merchant-subscription.ts', () => ({ getOwnerBilling }))
vi.mock('@/lib/server/merchant-session.ts', () => ({
  requireMerchantSession: vi.fn()
}))
vi.mock('@/lib/server/merchant-messaging.ts', () => ({
  canManageMerchantMessaging: vi.fn(async () => false)
}))

describe('Settings detail loading', () => {
  it('reads Owner Billing only from the Subscription child route', async () => {
    const { Route: settingsRoute } = await import('./settings.tsx')
    const { Route: subscriptionRoute } = await import('./settings.subscription.tsx')

    expect(settingsRoute.options.loader).toBeUndefined()
    expect(subscriptionRoute.options.loader).toEqual(expect.any(Function))

    const loader = subscriptionRoute.options.loader
    if (typeof loader !== 'function') throw new Error('Subscription loader is missing')
    await loader({} as never)

    expect(getOwnerBilling).toHaveBeenCalledOnce()
  })
})
