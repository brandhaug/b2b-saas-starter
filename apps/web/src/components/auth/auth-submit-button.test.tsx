import { screen } from '@testing-library/react'
import { type ReactNode } from 'react'
import { describe, expect, it } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import { AuthSubmitButton } from './auth-submit-button'

function formWithState(canSubmit: boolean, isSubmitting: boolean) {
  return {
    Subscribe: ({
      children
    }: {
      readonly children: (state: readonly [boolean, boolean]) => ReactNode
    }) => children([canSubmit, isSubmitting])
  }
}

describe('AuthSubmitButton', () => {
  it('exposes the pending label through a live region outside the decorative spinner', async () => {
    await renderWithRouter(
      <AuthSubmitButton
        form={formWithState(true, true)}
        label="Continue"
        submittingLabel="Signing in…"
      />
    )

    const button = screen.getByRole('button', { name: 'Continue' })
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.hasAttribute('disabled')).toBe(true)
    const status = screen.getByRole('status')
    expect(status.textContent).toContain('Signing in…')
    expect(status.classList.contains('sr-only')).toBe(true)
  })

  it('keeps the pending status empty when the form is idle', async () => {
    await renderWithRouter(
      <AuthSubmitButton
        form={formWithState(true, false)}
        label="Continue"
        submittingLabel="Signing in…"
      />
    )

    expect(
      screen.getByRole('button', { name: 'Continue' }).getAttribute('aria-busy')
    ).toBe('false')
    expect(screen.getByRole('status').textContent).toBe('')
  })
})
