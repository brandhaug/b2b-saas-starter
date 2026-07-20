// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MerchantPresentationBoundary,
  MerchantPresentationProvider
} from './merchant-presentation.tsx'
import type { MerchantPresentation } from '@/lib/merchant-presentation.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('MerchantPresentationProvider browser behavior', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('keeps the entry presentation when its parent rerenders', async () => {
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
})
