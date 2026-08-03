// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SmartAnimateText } from './smart-text-animate.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16)
  )
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => clearTimeout(handle))
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('SmartAnimateText', () => {
  it('settles every digit and letter after rerenders interrupt the animation', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<SmartAnimateText value="7" />)
    })
    await act(async () => {
      root?.render(<SmartAnimateText value="14" />)
    })
    await act(async () => {
      root?.render(<SmartAnimateText value="14" />)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    const characters = container.querySelectorAll<HTMLElement>(
      ':scope > div > div > span'
    )
    expect(characters).toHaveLength(2)
    expect(Array.from(characters, (character) => character.textContent)).toEqual([
      '1',
      '4'
    ])
    characters.forEach((character) => {
      expect(character.style.opacity).toBe('1')
    })

    await act(async () => {
      root?.render(<SmartAnimateText value="Monday" />)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    await act(async () => {
      root?.render(
        <SmartAnimateText value="Tuesday" staggerDelay={0.1} enterBlur={52} />
      )
    })
    await act(async () => {
      root?.render(
        <SmartAnimateText value="Tuesday" staggerDelay={0.1} enterBlur={40} />
      )
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    const weekdayCharacters = container.querySelectorAll<HTMLElement>(
      ':scope > div > div > span'
    )
    expect(weekdayCharacters).toHaveLength(7)
    expect(
      Array.from(weekdayCharacters, (character) => character.textContent).join('')
    ).toBe('Tuesday')
    expect(
      Array.from(weekdayCharacters, (character) => character.style.opacity)
    ).toEqual(Array(7).fill('1'))
    expect(
      Array.from(weekdayCharacters, (character) => character.style.filter)
    ).toEqual(Array(7).fill('blur(0px)'))

    const tuesdayCharacters = Array.from(weekdayCharacters)

    await act(async () => {
      root?.render(<SmartAnimateText value="Thursday" />)
    })

    const thursdayCharacters = Array.from(
      container.querySelectorAll<HTMLElement>(':scope > div > div > span')
    )
    expect(thursdayCharacters.map((character) => character.textContent).join('')).toBe(
      'Thursday'
    )
    expect(thursdayCharacters[0]).toBe(tuesdayCharacters[0])
    expect(thursdayCharacters.slice(4)).toEqual(tuesdayCharacters.slice(3))
    expect(thursdayCharacters[2]).not.toBe(tuesdayCharacters[1])
  })
})
