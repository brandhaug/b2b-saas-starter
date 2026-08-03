// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { MerchantSubscriptionPanel } from './merchant-subscription-panel.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
})

describe('MerchantSubscriptionPanel interactions', () => {
  it('renders one immutable Solo entitlement without plan controls', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => root?.render(<MerchantSubscriptionPanel plan="solo" />))

    const panel = container.querySelector('[data-merchant-subscription-panel]')
    expect(container.querySelector('[data-merchant-subscription-panel]')).toBe(panel)
    expect(container.textContent).toContain('One active professional')
    expect(container.textContent).not.toContain('Team')
    expect(container.querySelectorAll('button')).toHaveLength(1)
  })
})
