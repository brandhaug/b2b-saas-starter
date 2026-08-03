// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMobileEdgeScrollSpring } from './use-mobile-edge-scroll-spring.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function SpringFixture() {
  const ref = useMobileEdgeScrollSpring()
  return (
    <div data-mobile-sheet-scroll="true">
      <ul ref={ref} data-mobile-edge-spring="idle" />
    </div>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useMobileEdgeScrollSpring', () => {
  it('starts a bottom-edge spring after a fast wheel fling', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false }))
    )
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1)
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(<SpringFixture />))

    const scrollport = container.querySelector<HTMLElement>(
      '[data-mobile-sheet-scroll]'
    )
    const list = container.querySelector<HTMLElement>('[data-mobile-edge-spring]')
    if (!scrollport || !list) throw new Error('Expected edge spring fixture')

    Object.defineProperties(scrollport, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, writable: true, value: 0 }
    })

    await act(async () => {
      scrollport.dispatchEvent(new WheelEvent('wheel', { deltaY: 900 }))
      scrollport.scrollTop = 600
      scrollport.dispatchEvent(new Event('scroll'))
    })

    expect(list.dataset.mobileEdgeSpring).toBe('active')
    expect(list.style.transform).toBe('translate3d(0, -16px, 0)')

    await act(async () => root.unmount())
    container.remove()
  })
})
