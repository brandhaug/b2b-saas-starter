// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MerchantPresentationBoundary,
  MerchantPresentationProvider
} from './merchant-presentation.tsx'
import {
  MOBILE_MERCHANT_PRESENTATION_QUERY,
  type MerchantPresentation
} from '@/lib/merchant-presentation.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.innerHTML = ''
  document.documentElement.classList.remove('merchant-mobile-document')
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('responsive Merchant App presentation', () => {
  it('keeps the entry presentation when viewport observation is unavailable', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const render = (presentation: MerchantPresentation) =>
      root.render(
        <MerchantPresentationProvider presentation={presentation}>
          <MerchantPresentationBoundary
            desktop={<p>Desktop appointments</p>}
            mobile={<p>Mobile appointments</p>}
          />
        </MerchantPresentationProvider>
      )

    await act(async () => render('mobile'))
    await act(async () => render('desktop'))

    expect(container.textContent).toBe('Mobile appointments')
    await act(async () => root.unmount())
  })

  it('follows installed-window geometry after hydration and as it changes', async () => {
    let matches = false
    const listeners = new Set<(event: MediaQueryListEvent) => void>()
    const matchMedia = vi.fn().mockImplementation(
      (query: string) =>
        ({
          media: query,
          get matches() {
            return matches
          },
          addEventListener: (
            _type: string,
            listener: (event: MediaQueryListEvent) => void
          ) => {
            listeners.add(listener)
          },
          removeEventListener: (
            _type: string,
            listener: (event: MediaQueryListEvent) => void
          ) => {
            listeners.delete(listener)
          }
        }) as unknown as MediaQueryList
    )
    vi.stubGlobal('matchMedia', matchMedia)

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <MerchantPresentationProvider presentation="mobile">
          <MerchantPresentationBoundary
            mobile={<p>Mobile presentation</p>}
            desktop={<p>Desktop presentation</p>}
          />
        </MerchantPresentationProvider>
      )
    })

    expect(matchMedia).toHaveBeenCalledWith(MOBILE_MERCHANT_PRESENTATION_QUERY)
    expect(container.textContent).toBe('Desktop presentation')
    expect(
      document.documentElement.classList.contains('merchant-mobile-document')
    ).toBe(false)

    matches = true
    await act(async () => {
      listeners.forEach((listener) =>
        listener({ matches: true } as MediaQueryListEvent)
      )
    })

    expect(container.textContent).toBe('Mobile presentation')
    expect(
      document.documentElement.classList.contains('merchant-mobile-document')
    ).toBe(true)

    await act(async () => root.unmount())
  })
})
