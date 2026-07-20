import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  MerchantPresentationBoundary,
  MerchantPresentationProvider
} from './merchant-presentation.tsx'
import { merchantPresentationFromHeaders } from '@/lib/merchant-presentation.ts'

describe('merchantPresentationFromHeaders', () => {
  it('selects mobile for a phone and desktop for a tablet', () => {
    const phone = new Headers({
      'user-agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Mobile'
    })
    const tablet = new Headers({
      'user-agent': 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit Mobile'
    })

    expect(merchantPresentationFromHeaders(phone)).toBe('mobile')
    expect(merchantPresentationFromHeaders(tablet)).toBe('desktop')
  })

  it('prefers the browser mobile client hint when it is available', () => {
    const headers = new Headers({
      'sec-ch-ua-mobile': '?0',
      'user-agent': 'Mozilla/5.0 (Linux; Android 15; Mobile)'
    })

    expect(merchantPresentationFromHeaders(headers)).toBe('desktop')
  })
})

describe('MerchantPresentationBoundary', () => {
  it('renders only the selected presentation subtree', () => {
    const renderDesktop = vi.fn()
    const renderMobile = vi.fn()

    function DesktopAppointments() {
      renderDesktop()
      return <p>Desktop appointments</p>
    }

    function MobileAppointments() {
      renderMobile()
      return <p>Mobile appointments</p>
    }

    const html = renderToStaticMarkup(
      <MerchantPresentationProvider presentation="mobile">
        <MerchantPresentationBoundary
          desktop={<DesktopAppointments />}
          mobile={<MobileAppointments />}
        />
      </MerchantPresentationProvider>
    )

    expect(html).toContain('Mobile appointments')
    expect(html).not.toContain('Desktop appointments')
    expect(renderMobile).toHaveBeenCalledOnce()
    expect(renderDesktop).not.toHaveBeenCalled()
  })
})
