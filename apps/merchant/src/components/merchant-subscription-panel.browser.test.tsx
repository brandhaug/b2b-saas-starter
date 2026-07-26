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
  it('compares plans in place without mutating the current plan', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => root?.render(<MerchantSubscriptionPanel plan="team" />))

    const panel = container.querySelector('[data-merchant-subscription-panel]')
    const solo = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Solo'
    )
    await act(async () => solo?.click())

    expect(container.querySelector('[data-merchant-subscription-panel]')).toBe(panel)
    expect(solo?.getAttribute('aria-pressed')).toBe('true')
    expect(container.textContent).toContain('One active provider')
    expect(container.textContent).toContain('Billing not configured')
    expect(container.textContent).toContain('Team')
  })
})
