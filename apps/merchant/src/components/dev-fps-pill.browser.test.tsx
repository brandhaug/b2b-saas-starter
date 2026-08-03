// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DevFpsPill } from './dev-fps-pill.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('DevFpsPill', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('reports consecutive animation-frame sample windows accurately', async () => {
    const frames: FrameRequestCallback[] = []
    const cancelAnimationFrame = vi.fn()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame)

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => root.render(<DevFpsPill />))
    await act(async () => {
      for (let frame = 0; frame <= 60; frame += 1) {
        frames.shift()?.((frame * 1_000) / 60)
      }
    })

    expect(container.textContent).toContain('60 FPS')

    await act(async () => root.unmount())
    expect(cancelAnimationFrame).toHaveBeenCalledOnce()
  })
})
