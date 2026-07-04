import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FormTextField } from './form-text-field'

describe('FormTextField', () => {
  it('associates the label with the input and forwards changes as strings', () => {
    const onChange = vi.fn()
    render(
      <FormTextField
        name="email"
        label="Email"
        value=""
        errors={[]}
        onBlur={() => {}}
        onChange={onChange}
      />
    )
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'demo@starter.local' }
    })
    expect(onChange).toHaveBeenCalledWith('demo@starter.local')
  })

  it('renders no error markup when there are no errors', () => {
    render(
      <FormTextField
        name="email"
        label="Email"
        value="x"
        errors={[]}
        onBlur={() => {}}
        onChange={() => {}}
      />
    )
    const input = screen.getByLabelText('Email')
    expect(input.getAttribute('aria-invalid')).toBe('false')
    expect(input.getAttribute('aria-describedby')).toBeNull()
  })

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

  it('calls onBlur when the input loses focus', () => {
    const onBlur = vi.fn()
    render(
      <FormTextField
        name="email"
        label="Email"
        value=""
        errors={[]}
        onBlur={onBlur}
        onChange={() => {}}
      />
    )
    fireEvent.blur(screen.getByLabelText('Email'))
    expect(onBlur).toHaveBeenCalledTimes(1)
  })
})
