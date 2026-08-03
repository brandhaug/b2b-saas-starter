import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MerchantAbout } from './merchant-about.tsx'

describe('MerchantAbout', () => {
  it('presents BeeSolo product context without recreating the logo as a tile', () => {
    const html = renderToStaticMarkup(<MerchantAbout />)

    expect(html).toContain('About BeeSolo')
    expect(html).toContain('Appointments, customers, services, and availability')
    expect(html).toContain('fill="currentColor"')
    expect(html).not.toContain('bg-white')
  })
})
