import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SmartAnimateText } from './smart-animate-text'
import { createRemovedCharacterMotion } from './smart-animate-text-motion'

describe('SmartAnimateText', () => {
  it('exposes the current value once to assistive technology', () => {
    const { container, rerender } = render(<SmartAnimateText value="$0.00" />)

    expect(screen.getByLabelText('$0.00')).toBeTruthy()
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(5)

    rerender(<SmartAnimateText value="$10.00" />)
    expect(screen.getByLabelText('$10.00')).toBeTruthy()
  })

  it('animates letters and digits while leaving punctuation static', () => {
    const { container } = render(<SmartAnimateText value="mon." />)

    expect(container.querySelectorAll('[data-character-kind="animated"]')).toHaveLength(
      3
    )
    expect(container.querySelectorAll('[data-character-kind="static"]')).toHaveLength(1)
  })

  it('settles changed characters in their visible state', async () => {
    const { container, rerender } = render(<SmartAnimateText value="mon." />)

    rerender(<SmartAnimateText value="tue." />)

    await waitFor(
      () => {
        const animatedCharacters = container.querySelectorAll(
          '[data-character-kind="animated"] > span'
        )
        expect(animatedCharacters).toHaveLength(3)
        animatedCharacters.forEach((character) => {
          expect(character.getAttribute('style')).toContain('opacity: 1')
        })
      },
      { timeout: 1500 }
    )
  })

  it('applies spacing and character wrapper classes', () => {
    const { container } = render(
      <SmartAnimateText value="42" gap={6} digitClassName="tabular-nums" />
    )

    const root = container.querySelector('[data-slot="smart-animate-text"]')
    expect(root?.getAttribute('style')).toContain('gap: 6px')
    expect(container.querySelectorAll('.tabular-nums')).toHaveLength(2)
  })

  it('staggers removed characters before surviving changed characters', () => {
    const result = createRemovedCharacterMotion({
      baseMotion: {
        damping: 10,
        enterBlur: 52,
        enterScale: 0.7,
        enterY: 32,
        sign: -1,
        stiffness: 170
      },
      characters: Array.from('$0.00'),
      prefersReducedMotion: false,
      previousCharacters: Array.from('$100.00'),
      staggerDelay: 0.04
    })

    expect(result.count).toBe(2)
    expect(result.motion[5]).toMatchObject({ delay: 0, sign: -1 })
    expect(result.motion[4]).toMatchObject({ delay: 0.04, sign: -1 })
  })
})
