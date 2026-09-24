import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { FormTextField } from './form-text-field'

describe('FormTextField', () => {
  it('renders joined errors and wires the aria attributes to them', () => {
    render(
      <FormTextField
        name="email"
        label="Email"
        value="x"
        errors={['Email is required', 'Enter a valid email']}
        onBlur={() => {}}
        onChange={() => {}}
      />
    )
    const input = screen.getByLabelText('Email')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe('email-error')
    const error = screen.getByText('Email is required, Enter a valid email')
    expect(error.id).toBe('email-error')
  })
})
