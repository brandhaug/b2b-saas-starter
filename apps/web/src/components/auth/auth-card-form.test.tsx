import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import { AuthCardForm } from './auth-card-form'
import { Input } from '@/components/ui/input'

describe('AuthCardForm', () => {
  it('uses a safe POST fallback and delegates hydrated submits', async () => {
    const handleSubmit = vi.fn()
    await renderWithRouter(
      <AuthCardForm title="Sign in" form={{ handleSubmit }}>
        <Input aria-label="Email" name="email" />
        <Input aria-label="Password" name="password" type="password" />
      </AuthCardForm>,
      { destinations: ['/help'] }
    )

    const form = screen.getByLabelText('Email').closest('form')
    if (!(form instanceof HTMLFormElement)) {
      throw new Error('Email field should be inside the auth form')
    }
    expect(form.getAttribute('method')).toBe('post')
    expect(form.getAttribute('data-hydrated')).toBe('true')
    const fieldset = form.querySelector('fieldset')
    if (!(fieldset instanceof HTMLFieldSetElement)) {
      throw new Error('Auth controls should be guarded by a fieldset')
    }
    expect(fieldset.disabled).toBe(false)

    fireEvent.submit(form)
    expect(handleSubmit).toHaveBeenCalledOnce()
  })
})
