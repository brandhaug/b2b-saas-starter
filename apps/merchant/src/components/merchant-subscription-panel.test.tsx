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
    expect(html).toContain('Needs configuration')
    expect(html).toContain('billing provider is connected')
    expect(html).toContain('See Team plan details')
    expect(html).not.toContain('$')
    expect(html).not.toContain('Upgrade now')
  })

  it('renders Team as the current plan when that is the merchant presentation', () => {
    const html = renderToStaticMarkup(<MerchantSubscriptionPanel plan="team" />)

    expect(html).toMatch(/aria-pressed="true"[^>]*>Team<\/button>/)
    expect(html).toContain('Multiple providers')
  })
})
