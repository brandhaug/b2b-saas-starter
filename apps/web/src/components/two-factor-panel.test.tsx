import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { TwoFactorPanel } from './two-factor-panel'
import { renderWithQueryClient } from '@/test/query-harness'
import { authClient } from '@/lib/auth-client'

// The flows call the client module directly, so their endpoints are doubles
// on the mocked module.
vi.mock('@/lib/auth-client', async () => {
  const { fakeAuthClient } = await import('@/test/fake-auth-client')
  return { authClient: fakeAuthClient() }
})

const enableTwoFactor = vi.mocked(authClient.twoFactor.enable)
const verifyTotp = vi.mocked(authClient.twoFactor.verifyTotp)
const disableTwoFactor = vi.mocked(authClient.twoFactor.disable)
const generateBackupCodes = vi.mocked(authClient.twoFactor.generateBackupCodes)

const TOTP_URI =
  'otpauth://totp/B2B%20SaaS%20Starter:demo%40starter.local?secret=JBSWY3DPEHPK3PXP&issuer=B2B%2BSaaS%20Starter'

describe('TwoFactorPanel', () => {
  beforeEach(() => {
    enableTwoFactor.mockReset()
    verifyTotp.mockReset()
    disableTwoFactor.mockReset()
    generateBackupCodes.mockReset()
    enableTwoFactor.mockResolvedValue({
      data: { totpURI: TOTP_URI }
    })
    verifyTotp.mockResolvedValue({ data: { status: true } })
    disableTwoFactor.mockResolvedValue({ data: { status: true } })
  })

  it('offers to enable when two-factor is off', () => {
    renderWithQueryClient(<TwoFactorPanel twoFactorEnabled={false} />)
    screen.getByText(/Off\. Add an authenticator-app code to sign-in/)
    expect(screen.getByLabelText('Password')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Start setup' })).toBeDefined()
  })

  it('reveals the QR and secret once, then verifies the first code', async () => {
    renderWithQueryClient(<TwoFactorPanel twoFactorEnabled={false} />)
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'correct-horse-battery-staple' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start setup' }))
    await waitFor(() =>
      expect(enableTwoFactor).toHaveBeenCalledWith({
        password: 'correct-horse-battery-staple'
      })
    )

    // The one-time reveal: a scannable QR and the plain secret.
    await screen.findByRole('figure', { name: 'Two-factor secret QR code' })
    screen.getByText(/JBSWY3DPEHPK3PXP/)

    fireEvent.change(screen.getByLabelText('Verification code'), {
      target: { value: '123456' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Verify code' }))
    await waitFor(() => expect(verifyTotp).toHaveBeenCalledWith({ code: '123456' }))
    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('now on')
  })

  it('shows the one-time backup codes from the enable response', async () => {
    enableTwoFactor.mockResolvedValue({
      data: { totpURI: TOTP_URI, backupCodes: ['abcd-1234', 'efgh-5678'] }
    })
    renderWithQueryClient(<TwoFactorPanel twoFactorEnabled={false} />)
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'correct-horse-battery-staple' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start setup' }))
    const codes = await screen.findByRole('region', { name: 'Backup codes' })
    expect(codes.textContent).toContain('abcd-1234')
    expect(codes.textContent).toContain('efgh-5678')

    // Verifying closes the one-time reveal — the codes are gone with it.
    fireEvent.change(screen.getByLabelText('Verification code'), {
      target: { value: '123456' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Verify code' }))
    await screen.findByRole('status')
    expect(screen.queryByRole('region', { name: 'Backup codes' })).toBeNull()
  })

  it('surfaces an invalid verification code and stays on the setup step', async () => {
    verifyTotp.mockResolvedValue({ error: { code: 'INVALID_CODE' } })
    renderWithQueryClient(<TwoFactorPanel twoFactorEnabled={false} />)
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'correct-horse-battery-staple' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start setup' }))
    await screen.findByRole('figure', { name: 'Two-factor secret QR code' })

    fireEvent.change(screen.getByLabelText('Verification code'), {
      target: { value: '000000' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Verify code' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('That code is incorrect. Check it and try again.')
    // Still on the setup step — the QR is still shown for another try.
    expect(
      screen.getByRole('figure', { name: 'Two-factor secret QR code' })
    ).toBeDefined()
  })

  it('asks for the password to turn two-factor off when enabled', async () => {
    renderWithQueryClient(<TwoFactorPanel twoFactorEnabled />)
    screen.getByText(/On\. Codes are required at sign-in/)
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'correct-horse-battery-staple' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }))
    await waitFor(() =>
      expect(disableTwoFactor).toHaveBeenCalledWith({
        password: 'correct-horse-battery-staple'
      })
    )
    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('off')
  })

  it('surfaces a wrong-password failure without flipping state', async () => {
    disableTwoFactor.mockResolvedValue({ error: { code: 'INVALID_PASSWORD' } })
    renderWithQueryClient(<TwoFactorPanel twoFactorEnabled />)
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'wrong-password' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('That password is incorrect. Try again.')
    // Still on.
    expect(screen.getByText(/On\. Codes are required at sign-in/)).toBeDefined()
  })

  it('regenerates backup codes behind a password confirmation', async () => {
    generateBackupCodes.mockResolvedValue({
      data: { backupCodes: ['new-1111', 'new-2222'] }
    })
    renderWithQueryClient(<TwoFactorPanel twoFactorEnabled />)
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'correct-horse-battery-staple' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate backup codes' }))
    await waitFor(() =>
      expect(generateBackupCodes).toHaveBeenCalledWith({
        password: 'correct-horse-battery-staple'
      })
    )
    const codes = await screen.findByRole('region', { name: 'Backup codes' })
    expect(codes.textContent).toContain('new-1111')
    expect(codes.textContent).toContain('new-2222')

    // Done dismisses the one-time reveal; the codes are not shown again.
    fireEvent.click(screen.getByRole('button', { name: 'I saved my codes' }))
    expect(screen.queryByRole('region', { name: 'Backup codes' })).toBeNull()
  })

  it('surfaces a failed backup-code regeneration without clearing the password state flip', async () => {
    generateBackupCodes.mockResolvedValue({ error: { code: 'INVALID_PASSWORD' } })
    renderWithQueryClient(<TwoFactorPanel twoFactorEnabled />)
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'wrong-password' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate backup codes' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('That password is incorrect. Try again.')
    expect(screen.queryByRole('region', { name: 'Backup codes' })).toBeNull()
  })

  it('treats an incomplete regeneration response as a failure', async () => {
    generateBackupCodes.mockResolvedValue({ data: {} })
    renderWithQueryClient(<TwoFactorPanel twoFactorEnabled />)
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'correct-horse-battery-staple' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate backup codes' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('incomplete')
  })
})
