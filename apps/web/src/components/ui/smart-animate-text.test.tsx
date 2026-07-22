import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SmartAnimateText } from './smart-animate-text'

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

  it('applies spacing and character wrapper classes', () => {
    const { container } = render(
      <SmartAnimateText value="42" gap={6} digitClassName="tabular-nums" />
    )

    const root = container.querySelector('[data-slot="smart-animate-text"]')
    expect(root?.getAttribute('style')).toContain('gap: 6px')
    expect(container.querySelectorAll('.tabular-nums')).toHaveLength(2)
  })
})
