// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImpersonationBanner } from './impersonation-banner.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const presentation = {
  targetMemberId: 'mem_browser',
  targetMemberName: 'Browser Target',
  merchantId: 'mer_browser',
  merchantName: 'Browser Merchant',
  expiresAt: '2026-07-19T16:00:02.000Z'
}

describe('ImpersonationBanner browser behavior', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('keeps the disclosure visible while stopping and invokes the stop boundary once', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const stop = vi.fn().mockResolvedValue(undefined)

    await act(async () => {
      root.render(
        <ImpersonationBanner
          presentation={presentation}
          now={() => new Date('2026-07-19T16:00:00.000Z')}
          onStop={stop}
          onExpired={() => undefined}
        />
      )
    })
    const stopButton = container.querySelector('button')!
    await act(async () => stopButton.click())

    expect(stop).not.toHaveBeenCalled()
    expect(container.textContent).toContain('End staff access now?')
    const confirmButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Confirm stop'
    )!
    await act(async () => confirmButton.click())

    expect(stop).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('Staff impersonation is active')
    expect(confirmButton.textContent).toBe('Stopping…')
    expect(confirmButton.disabled).toBe(true)
    await act(async () => root.unmount())
  })

  it('drives automatic expiry from the absolute timestamp exactly once', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-19T16:00:00.000Z'))
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const expired = vi.fn()

    await act(async () => {
      root.render(
        <ImpersonationBanner
          presentation={presentation}
          onStop={async () => undefined}
          onExpired={expired}
        />
      )
    })
    expect(container.textContent).toContain('00:02 remaining')

    await act(async () => vi.advanceTimersByTimeAsync(3_000))

    expect(container.textContent).toContain('00:00 remaining')
    expect(expired).toHaveBeenCalledOnce()
    await act(async () => root.unmount())
  })
})
