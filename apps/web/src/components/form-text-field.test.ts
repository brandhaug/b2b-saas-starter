/* oxlint-disable unicorn/prefer-dom-node-append -- Cloudflare Element.append has an incompatible HTMLRewriter signature. */
import { fireEvent, screen, waitFor } from '@testing-library/dom'
import { expect, it } from 'vite-plus/test'
import { renderAuth, input } from './native-test-harness'
import { Effect, Schema } from 'effect'
import { Runtime } from 'foldkit'
import { textField } from '@/foldkit/shared/view'

// Native auth fields currently emit one validator message per field. Preserve
// the accessible error relationship through the shipped form and DOM events.
it('renders field errors and wires the aria attributes to them', async () => {
  await renderAuth('sign-in')
  const email = screen.getByLabelText('Email')
  await input(email, 'x')
  fireEvent.blur(email)
  await waitFor(() => expect(email.getAttribute('aria-invalid')).toBe('true'))
  expect(email.getAttribute('aria-describedby')).toBe('email-error')
  expect(document.getElementById('email-error')?.textContent).toBe(
    'Enter a valid email'
  )
})

it('renders joined errors and wires the aria attributes to them', async () => {
  const container = document.createElement('div'),
    mount = document.createElement('div')
  mount.id = 'form-field-test'
  container.appendChild(mount)
  document.body.appendChild(container)
  const handle = Runtime.embed(
    Runtime.makeApplication({
      Flags: Schema.Null,
      Model: Schema.String,
      init: () => ({ model: 'x' }),
      update: (_model, message: { _tag: 'Changed'; value: string }) => ({
        model: message.value
      }),
      view: (value, h) => ({
        title: 'Field',
        body: textField(h, {
          name: 'email',
          label: 'Email',
          value,
          errors: ['Email is required', 'Enter a valid email'],
          changed: (next) => ({ _tag: 'Changed' as const, value: next })
        })
      }),
      container: mount
    }),
    { flags: Effect.succeed(null) }
  )
  try {
    const field = await screen.findByLabelText('Email')
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(field.getAttribute('aria-describedby')).toBe('email-error')
    expect(screen.getByText('Email is required, Enter a valid email').id).toBe(
      'email-error'
    )
  } finally {
    handle.dispose()
    container.remove()
  }
})
