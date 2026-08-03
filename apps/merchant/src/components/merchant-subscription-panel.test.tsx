import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MerchantSubscriptionPanel } from './merchant-subscription-panel.tsx'

describe('MerchantSubscriptionPanel', () => {
  it('shows the persisted current plan without inventing billing state', () => {
    const html = renderToStaticMarkup(<MerchantSubscriptionPanel plan="solo" />)

    expect(html).toContain('data-merchant-subscription-panel="true"')
    expect(html).toContain('Solo')
    expect(html).toContain('Current plan')
    expect(html).toContain('Billing')
    expect(html).toContain('Billing configuration is not connected yet')
    expect(html).toContain('One active professional')
    expect(html).not.toContain('Team')
    expect(html).not.toContain('$')
    expect(html).not.toContain('Upgrade now')
  })
})
