import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import { authClient } from '@/lib/auth-client'
import { TwoFactorChallengePage } from './two-factor'

// The page calls the client module directly, so its verify endpoints are
// doubles on the mocked module. The router is real, so the redirect
// assertions read the resulting location instead of asking whether a
// `history.push` double was called.
vi.mock('@/lib/auth-client', async () => {
  const { fakeAuthClient } = await import('@/test/fake-auth-client')
  return { authClient: fakeAuthClient() }
})

const verifyTotp = vi.mocked(authClient.twoFactor.verifyTotp)
const verifyBackupCode = vi.mocked(authClient.twoFactor.verifyBackupCode)

async function renderPage(redirect?: string) {
  const rendered = await renderWithRouter(
    <TwoFactorChallengePage {...(redirect === undefined ? {} : { redirect })} />,
    { path: '/two-factor', destinations: ['/workspaces', '/workspaces/starter-lab'] }
  )
  await screen.findByLabelText('Verification code')
  return rendered
}

function submitTotp() {
  fireEvent.change(screen.getByLabelText('Verification code'), {
    target: { value: '123456' }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }))
}

/** Switches to the backup-code branch and waits for its form to render. */
async function switchToBackupMode() {
  fireEvent.click(screen.getByRole('button', { name: 'Use a backup code' }))
  await screen.findByLabelText('Backup code')
  expect(screen.queryByLabelText('Verification code')).toBeNull()
}

/**
 * The trust checkbox by role+name: Base UI renders it as a `span[role=
 * "checkbox"]` with a hidden form-participation `<input>` sharing the label,
 * so `getByLabelText` matches both and the role query is the unambiguous one.
 */
function trustCheckbox(): HTMLElement {
  return screen.getByRole('checkbox', { name: 'Trust this device for 30 days' })
}

describe('TwoFactorChallengePage', () => {
  beforeEach(() => {
    verifyTotp.mockReset()
    verifyTotp.mockResolvedValue({ error: null })
    verifyBackupCode.mockReset()
    verifyBackupCode.mockResolvedValue({ error: null })
  })

  it('verifies the TOTP code and redirects to /workspaces by default', async () => {
    const { router } = await renderPage()
    submitTotp()
    await waitFor(() => expect(verifyTotp).toHaveBeenCalledTimes(1))
    expect(verifyTotp).toHaveBeenCalledWith({ code: '123456', trustDevice: false })
    await waitFor(() => expect(router.state.location.pathname).toBe('/workspaces'))
  })

  it('honours a same-origin redirect search param', async () => {
    const { router } = await renderPage('/workspaces/starter-lab')
    submitTotp()
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/workspaces/starter-lab')
    )
  })

  it('surfaces verification errors as table copy and stays on the challenge', async () => {
    verifyTotp.mockResolvedValueOnce({ error: { code: 'INVALID_CODE' } })
    const { router } = await renderPage()
    submitTotp()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('That code is incorrect. Check it and try again.')
    expect(router.state.location.pathname).toBe('/two-factor')
  })

  it('swaps to a backup-code form and verifies through the backup port', async () => {
    const { router } = await renderPage()
    await switchToBackupMode()
    // The enrollment promise the copy has to keep: ten one-time codes.
    expect(
      screen.getByText(/one of the ten codes you saved when you set up two-factor/i)
    ).toBeDefined()
    fireEvent.change(screen.getByLabelText('Backup code'), {
      target: { value: '  aB3dE-f9gH1 ' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    await waitFor(() => expect(verifyBackupCode).toHaveBeenCalledTimes(1))
    // Trimmed on the way out: the field's whitespace is not the code's.
    expect(verifyBackupCode).toHaveBeenCalledWith({
      code: 'aB3dE-f9gH1',
      trustDevice: false
    })
    expect(verifyTotp).not.toHaveBeenCalled()
    await waitFor(() => expect(router.state.location.pathname).toBe('/workspaces'))
  })

  it('swaps back to the authenticator form', async () => {
    await renderPage()
    await switchToBackupMode()
    fireEvent.click(
      screen.getByRole('button', { name: 'Use an authenticator code instead' })
    )
    await screen.findByLabelText('Verification code')
    expect(screen.queryByLabelText('Backup code')).toBeNull()
  })

  it('forwards trustDevice on the TOTP verification when the box is checked', async () => {
    await renderPage()
    fireEvent.click(trustCheckbox())
    submitTotp()
    await waitFor(() => expect(verifyTotp).toHaveBeenCalledTimes(1))
    expect(verifyTotp).toHaveBeenCalledWith({ code: '123456', trustDevice: true })
  })

  it('forwards trustDevice on the backup-code verification when the box is checked', async () => {
    await renderPage()
    await switchToBackupMode()
    fireEvent.click(trustCheckbox())
    fireEvent.change(screen.getByLabelText('Backup code'), {
      target: { value: 'aB3dE-f9gH1' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    await waitFor(() => expect(verifyBackupCode).toHaveBeenCalledTimes(1))
    expect(verifyBackupCode).toHaveBeenCalledWith({
      code: 'aB3dE-f9gH1',
      trustDevice: true
    })
  })

  it('keeps the trust checkbox unchecked by default in both modes', async () => {
    await renderPage()
    expect(trustCheckbox().getAttribute('aria-checked')).toBe('false')
    await switchToBackupMode()
    expect(trustCheckbox().getAttribute('aria-checked')).toBe('false')
  })
})
