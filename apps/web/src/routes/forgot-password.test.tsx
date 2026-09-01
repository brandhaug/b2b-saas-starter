import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import { ForgotPasswordPage, type RequestPasswordReset } from './forgot-password'

// The page's own `requestReset` port, handed in as a prop.
const requestReset = vi.fn<RequestPasswordReset>()

async function renderPage() {
  const rendered = await renderWithRouter(
    <ForgotPasswordPage requestReset={requestReset} />,
    { path: '/forgot-password', destinations: ['/sign-in'] }
  )
  await screen.findByLabelText('Email')
  return rendered
}

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    requestReset.mockReset()
    requestReset.mockResolvedValue({ error: null })
  })

  it('shows validation errors and disables submit for invalid input', async () => {
    await renderPage()
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'not-an-email' }
    })
    await screen.findByText('Enter a valid email')
    const submit = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Send reset link'
    })
    expect(submit.disabled).toBe(true)
    expect(requestReset).not.toHaveBeenCalled()
  })

  it('submits the email and replaces the form with the sent state', async () => {
    await renderPage()
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'demo@starter.local' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    await waitFor(() => expect(requestReset).toHaveBeenCalledTimes(1))
    expect(requestReset).toHaveBeenCalledWith({ email: 'demo@starter.local' })
    await screen.findByText(/check your inbox for a reset link/i)
    expect(screen.queryByLabelText('Email')).toBeNull()
  })

  it('never echoes the address or an account-existence signal in the sent state', async () => {
    // The endpoint answers identically for unknown emails (enumeration
    // defense) — the page must not know more than the endpoint does, so the
    // sent state stays constant and does not even name the address it sent to.
    await renderPage()
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'nobody@nowhere.test' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    const message = await screen.findByText(/check your inbox for a reset link/i)
    expect(message.textContent).not.toContain('nobody@nowhere.test')
  })

  it('surfaces request errors and keeps the form', async () => {
    requestReset.mockResolvedValueOnce({
      error: { message: 'Too many requests' }
    })
    await renderPage()
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'demo@starter.local' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Too many requests')
    expect(screen.getByLabelText('Email')).toBeDefined()
  })

  it('links back to sign-in', async () => {
    await renderPage()
    // The public layout carries its own sign-in links, so the assertion is
    // that some sign-in link lands on /sign-in, not that exactly one exists.
    const hrefs = screen
      .getAllByRole('link', { name: 'Sign in' })
      .map((link) => link.getAttribute('href'))
    expect(hrefs).toContain('/sign-in')
  })
})
