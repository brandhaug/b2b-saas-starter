import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { Button } from './button'
import { IconTransition } from './icon-transition'

describe('shared interaction polish', () => {
  it('disables press feedback without leaking Button static to the DOM', () => {
    render(
      <>
        <Button>Save</Button>
        <Button static>Cancel</Button>
      </>
    )
    const regular = screen.getByRole('button', { name: 'Save' })
    const staticButton = screen.getByRole('button', { name: 'Cancel' })

    expect(regular.getAttribute('class')?.includes('active:scale-[0.96]')).toBe(true)
    expect(staticButton.getAttribute('class')?.includes('active:scale-[0.96]')).toBe(
      false
    )
    expect(staticButton.hasAttribute('static')).toBe(false)
  })

  it('preserves both contextual icon nodes while switching state', () => {
    const { rerender } = render(
      <IconTransition
        active={false}
        data-icon="inline-start"
        idle={<span data-testid="idle" />}
        activeIcon={<span data-testid="active" />}
      />
    )
    const idle = screen.getByTestId('idle')
    const active = screen.getByTestId('active')
    const iconSlot = idle.parentElement?.parentElement

    expect(iconSlot?.getAttribute('aria-hidden')).toBe('true')
    expect(iconSlot?.getAttribute('data-icon')).toBe('inline-start')
    rerender(
      <IconTransition
        active
        data-icon="inline-start"
        idle={<span data-testid="idle" />}
        activeIcon={<span data-testid="active" />}
      />
    )
    expect(screen.getByTestId('idle')).toBe(idle)
    expect(screen.getByTestId('active')).toBe(active)
  })
})
