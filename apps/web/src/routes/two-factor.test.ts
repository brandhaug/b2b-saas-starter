import { fireEvent, screen, waitFor } from '@testing-library/dom'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { input, renderAuth } from '@/components/native-test-harness'
import { authClient } from '@/lib/auth-client'
import { navigateDocument } from '@/lib/document-navigation'
import * as m from '@b2b-saas-starter/i18n/messages'

// Preserve TOTP/backup payloads, safe destinations, errors, method changes and explicit trust.
vi.mock('@/lib/document-navigation', () => ({ navigateDocument: vi.fn() }))
vi.mock('@/lib/auth-client', async () => {
  const { fakeAuthClient } = await import('@/test/fake-auth-client')
  return { authClient: fakeAuthClient() }
})

const verifyTotp = vi.mocked(authClient.twoFactor.verifyTotp)
const verifyBackupCode = vi.mocked(authClient.twoFactor.verifyBackupCode)

async function renderPage(redirect?: string) {
  const rendered = await renderAuth('two-factor', {
    search: redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''
  })
  await screen.findByLabelText('Verification code')
  return rendered
}

async function submitTotp() {
  await input(screen.getByLabelText('Verification code'), '123456')
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
function trustCheckbox(): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>('checkbox', { name: m.trust_device() })
}

describe('TwoFactorChallengePage', () => {
  beforeEach(() => {
    vi.mocked(navigateDocument).mockReset()
    verifyTotp.mockReset()
    verifyTotp.mockResolvedValue({ error: null })
    verifyBackupCode.mockReset()
    verifyBackupCode.mockResolvedValue({ error: null })
  })

  it('verifies the TOTP code and redirects to /workspaces by default', async () => {
    await renderPage()
    await submitTotp()
    await waitFor(() => expect(verifyTotp).toHaveBeenCalledTimes(1))
    expect(verifyTotp).toHaveBeenCalledWith({ code: '123456', trustDevice: false })
    await waitFor(() => expect(navigateDocument).toHaveBeenCalledWith('/workspaces'))
  })

  it('honours a same-origin redirect search param', async () => {
    await renderPage('/workspaces/starter-lab')
    await submitTotp()
    await waitFor(() =>
      expect(navigateDocument).toHaveBeenCalledWith('/workspaces/starter-lab')
    )
  })

  it('surfaces verification errors as table copy and stays on the challenge', async () => {
    verifyTotp.mockResolvedValueOnce({ error: { code: 'INVALID_CODE' } })
    await renderPage()
    await submitTotp()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('That code is incorrect. Check it and try again.')
    expect(navigateDocument).not.toHaveBeenCalled()
  })

  it('swaps to a backup-code form and verifies through the backup port', async () => {
    await renderPage()
    await switchToBackupMode()
    // The enrollment promise the copy has to keep: ten one-time codes.
    expect(screen.getByText(m.backup_code_description())).toBeDefined()
    await input(screen.getByLabelText('Backup code'), '  aB3dE-f9gH1 ')
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    await waitFor(() => expect(verifyBackupCode).toHaveBeenCalledTimes(1))
    // Trimmed on the way out: the field's whitespace is not the code's.
    expect(verifyBackupCode).toHaveBeenCalledWith({
      code: 'aB3dE-f9gH1',
      trustDevice: false
    })
    expect(verifyTotp).not.toHaveBeenCalled()
    await waitFor(() => expect(navigateDocument).toHaveBeenCalledWith('/workspaces'))
  })

  it('swaps back to the authenticator form', async () => {
    await renderPage()
    await switchToBackupMode()
    fireEvent.click(screen.getByRole('button', { name: m.use_authenticator_code() }))
    await screen.findByLabelText('Verification code')
    expect(screen.queryByLabelText('Backup code')).toBeNull()
  })

  it('forwards trustDevice on the TOTP verification when the box is checked', async () => {
    await renderPage()
    fireEvent.click(trustCheckbox())
    await submitTotp()
    await waitFor(() => expect(verifyTotp).toHaveBeenCalledTimes(1))
    expect(verifyTotp).toHaveBeenCalledWith({ code: '123456', trustDevice: true })
  })

  it('forwards trustDevice on the backup-code verification when the box is checked', async () => {
    await renderPage()
    await switchToBackupMode()
    fireEvent.click(trustCheckbox())
    await input(screen.getByLabelText('Backup code'), 'aB3dE-f9gH1')
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    await waitFor(() => expect(verifyBackupCode).toHaveBeenCalledTimes(1))
    expect(verifyBackupCode).toHaveBeenCalledWith({
      code: 'aB3dE-f9gH1',
      trustDevice: true
    })
  })

  it('keeps the trust checkbox unchecked by default in both modes', async () => {
    await renderPage()
    expect(trustCheckbox().checked).toBe(false)
    await switchToBackupMode()
    expect(trustCheckbox().checked).toBe(false)
  })
})
