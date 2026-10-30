import { fireEvent, screen, waitFor, within } from '@testing-library/dom'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { input } from '@/components/native-test-harness'
import { renderSecurity } from './test-runtime'
import { authClientDouble as fake } from '@/test/fake-auth-client'
import { m } from '@b2b-saas-starter/i18n/messages'

vi.mock('@/lib/auth-client', async () => {
  const { authClientDouble } = await import('@/test/fake-auth-client')
  return {
    authClient: {
      ...authClientDouble,
      getSession: vi.fn(async () => ({
        data: {
          session: {
            token: 'current',
            userAgent: 'Macintosh',
            ipAddress: '203.0.113.7',
            createdAt: new Date('2026-08-02T10:00:00Z'),
            expiresAt: new Date('2026-08-09T10:00:00Z')
          }
        }
      }))
    }
  }
})

const date = new Date('2026-08-01T10:00:00Z')
function session(token: string, userAgent: string) {
  return {
    token,
    userAgent,
    createdAt: date,
    expiresAt: date,
    ipAddress: '203.0.113.7'
  }
}
function linked(id: string, providerId: string) {
  return { id, providerId, createdAt: date }
}
const uri = 'otpauth://totp/Starter?secret=JBSWY3DPEHPK3PXP&issuer=Starter'

beforeEach(() => {
  vi.resetAllMocks()
  fake.listSessions.mockResolvedValue({
    data: [session('current', 'Macintosh'), session('other', 'iPhone')]
  })
  fake.passkey.listUserPasskeys.mockResolvedValue({ data: [] })
  fake.listAccounts.mockResolvedValue({
    data: [linked('password', 'credential'), linked('github', 'github')]
  })
  fake.revokeOtherSessions.mockResolvedValue({ error: null })
  fake.revokeSession.mockResolvedValue({ error: null })
  fake.unlinkAccount.mockResolvedValue({ error: null })
  fake.passkey.addPasskey.mockResolvedValue({ data: null })
  fake.twoFactor.enable.mockResolvedValue({ data: { totpURI: uri } })
  fake.twoFactor.verifyTotp.mockResolvedValue({ data: { status: true } })
  fake.twoFactor.disable.mockResolvedValue({ data: { status: true } })
})

async function click(name: string | RegExp) {
  fireEvent.click(await screen.findByRole('button', { name }))
}
async function confirm(name: string) {
  const dialog = await screen.findByRole('alertdialog')
  fireEvent.click(within(dialog).getByRole('button', { name }))
}
async function password(id: string, value = 'correct-horse-battery-staple') {
  const element = document.getElementById(id)
  expect(element).not.toBeNull()
  if (element) {
    await input(element, value)
  }
}
async function enroll() {
  await renderSecurity()
  await screen.findByText('GitHub')
  await password('twofactor-password-on')
  await click('Start setup')
  await screen.findByRole('figure', { name: 'Two-factor secret QR code' })
}

describe('sessions-panel migration', () => {
  it('marks the current session and offers to sign out everywhere else', async () => {
    await renderSecurity()
    await screen.findByText('· This device')
    expect(screen.getAllByText('· This device')).toHaveLength(1)
    expect(screen.getByText('Mobile browser')).not.toBeNull()
    expect(
      screen.getByRole('button', { name: 'Sign out everywhere else' })
    ).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Revoke session on Mac' })).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Revoke session on Mobile browser' })
    ).not.toBeNull()
  })

  // Failure inventory: the SDK's bounded session list can omit the current
  // session. Retain authenticated current-device evidence without duplication
  // or a revoke control, while preserving the returned other-device actions.
  it('retains the protected current device when the SDK list reaches its limit', async () => {
    fake.listSessions.mockResolvedValue({
      data: Array.from({ length: 100 }, (_, index) =>
        session(`other-${index}`, 'Windows')
      )
    })
    await renderSecurity()
    await screen.findByText('· This device')
    expect(screen.getAllByText('· This device')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Revoke session on Mac' })).toBeNull()
    expect(
      screen.getAllByRole('button', { name: 'Revoke session on Windows' })
    ).toHaveLength(100)
    expect(fake.revokeSession).not.toHaveBeenCalled()
  })

  it('signs out everywhere else with one action', async () => {
    fake.listSessions
      .mockResolvedValueOnce({
        data: [session('current', 'Macintosh'), session('other', 'iPhone')]
      })
      .mockResolvedValue({ data: [session('current', 'Macintosh')] })
    await renderSecurity()
    await click('Sign out everywhere else')
    await confirm('Sign out')
    await waitFor(() => expect(fake.revokeOtherSessions).toHaveBeenCalledTimes(1))
    expect(fake.revokeSession).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(fake.listSessions).toHaveBeenCalledTimes(2)
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Sign out everywhere else' })
      ).toBeNull()
    )
  })

  it('surfaces revocation failures', async () => {
    fake.revokeOtherSessions.mockResolvedValue({ error: {} })
    await renderSecurity()
    await click('Sign out everywhere else')
    await confirm('Sign out')
    const dialog = screen.getByRole('alertdialog')
    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toContain(m.session_action_failed())
  })

  it('lists sessions with the current one marked and the others revocable', async () => {
    await renderSecurity()
    await click('Revoke session on Mobile browser')
    await confirm('Revoke session')
    await waitFor(() =>
      expect(fake.revokeSession).toHaveBeenCalledWith({ token: 'other' })
    )
  })
})

describe('passkeys-panel migration', () => {
  it('lists named and unnamed passkeys with their sync state', async () => {
    fake.passkey.listUserPasskeys.mockResolvedValue({
      data: [
        { id: 'mac', name: 'MacBook Touch ID', backedUp: true, createdAt: date },
        { id: 'key', name: null, backedUp: false, createdAt: date }
      ]
    })
    await renderSecurity()
    await screen.findByText('MacBook Touch ID')
    expect(screen.getByText('Passkey')).not.toBeNull()
    expect(screen.getByText(/Synced passkey/)).not.toBeNull()
    expect(screen.getByText(/Device passkey/)).not.toBeNull()
    expect(
      screen.getByRole('button', { name: 'Rename MacBook Touch ID passkey' })
    ).not.toBeNull()
    expect(
      screen.getByRole('button', { name: 'Remove MacBook Touch ID passkey' })
    ).not.toBeNull()
  })

  it('omits the name when the field is left blank', async () => {
    await renderSecurity()
    await screen.findByText('GitHub')
    await click('Add passkey')
    await waitFor(() => expect(fake.passkey.addPasskey).toHaveBeenCalledWith({}))
  })

  it('surfaces a cancelled ceremony with the copy-table sentence', async () => {
    fake.passkey.addPasskey.mockResolvedValue({ error: { code: 'AUTH_CANCELLED' } })
    await renderSecurity()
    await screen.findByText('GitHub')
    await click('Add passkey')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('The passkey action was cancelled')
  })

  it('surfaces removal failures', async () => {
    fake.passkey.listUserPasskeys.mockResolvedValue({
      data: [{ id: 'mac', name: 'MacBook', backedUp: true, createdAt: date }]
    })
    fake.passkey.deletePasskey.mockResolvedValue({ error: {} })
    await renderSecurity()
    await click('Remove MacBook passkey')
    await confirm('Remove passkey')
    const alert = await within(screen.getByRole('alertdialog')).findByRole('alert')
    expect(alert.textContent).toContain('The change could not be made')
  })
})

describe('linked-accounts-panel migration', () => {
  it('lists every sign-in method with a human label', async () => {
    await renderSecurity()
    await screen.findByText('GitHub')
    expect(screen.getByText('email and password')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Unlink GitHub' })).not.toBeNull()
    expect(
      screen.getByRole('button', { name: 'Unlink email and password' })
    ).not.toBeNull()
  })

  it('refuses the only remaining sign-in method with a reason, not a control', async () => {
    fake.listAccounts.mockResolvedValue({ data: [linked('password', 'credential')] })
    await renderSecurity()
    await screen.findByText('email and password')
    expect(screen.queryByRole('button', { name: /Unlink/ })).toBeNull()
    expect(screen.getByText(/Add another sign-in method/)).not.toBeNull()
    expect(fake.unlinkAccount).not.toHaveBeenCalled()
  })

  it('unlinks a provider through the confirmation and refreshes the list', async () => {
    fake.listAccounts
      .mockResolvedValueOnce({
        data: [linked('password', 'credential'), linked('github', 'github')]
      })
      .mockResolvedValue({ data: [linked('password', 'credential')] })
    await renderSecurity()
    await click('Unlink GitHub')
    await confirm('Unlink')
    await waitFor(() =>
      expect(fake.unlinkAccount).toHaveBeenCalledWith({ accountId: 'github' })
    )
    await screen.findByText(/Add another sign-in method/)
    expect(screen.queryByText('GitHub')).toBeNull()
  })
})

describe('two-factor-panel migration', () => {
  it('reveals the QR and secret once, then verifies the first code', async () => {
    await enroll()
    expect(fake.twoFactor.enable).toHaveBeenCalledWith({
      password: 'correct-horse-battery-staple'
    })
    expect(screen.getByText('JBSWY3DPEHPK3PXP')).not.toBeNull()
    await input(screen.getByLabelText('Verification code'), '123456')
    await click('Verify code')
    await waitFor(() =>
      expect(fake.twoFactor.verifyTotp).toHaveBeenCalledWith({ code: '123456' })
    )
    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('now on')
    expect(screen.queryByRole('figure')).toBeNull()
  })

  it('shows the one-time backup codes from the enable response', async () => {
    fake.twoFactor.enable.mockResolvedValue({
      data: { totpURI: uri, backupCodes: ['abcd-1234', 'efgh-5678'] }
    })
    await enroll()
    const codes = screen.getByRole('region', { name: 'Backup codes' })
    expect(codes.textContent).toContain('abcd-1234')
    expect(codes.textContent).toContain('efgh-5678')
    await input(screen.getByLabelText('Verification code'), '123456')
    await click('Verify code')
    await screen.findByRole('status')
    expect(screen.queryByRole('region', { name: 'Backup codes' })).toBeNull()
  })

  it('surfaces an invalid verification code and stays on the setup step', async () => {
    fake.twoFactor.verifyTotp.mockResolvedValue({ error: { code: 'INVALID_CODE' } })
    await enroll()
    await input(screen.getByLabelText('Verification code'), '000000')
    await click('Verify code')
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'That code is incorrect. Check it and try again.'
    )
    expect(screen.getByRole('figure')).not.toBeNull()
  })

  it('asks for the password to turn two-factor off when enabled', async () => {
    await renderSecurity(true)
    await screen.findByText('GitHub')
    await password('twofactor-password-off')
    await click('Turn off')
    await waitFor(() =>
      expect(fake.twoFactor.disable).toHaveBeenCalledWith({
        password: 'correct-horse-battery-staple'
      })
    )
    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('off')
  })

  it('surfaces a wrong-password failure without flipping state', async () => {
    fake.twoFactor.disable.mockResolvedValue({ error: { code: 'INVALID_PASSWORD' } })
    await renderSecurity(true)
    await screen.findByText('GitHub')
    await password('twofactor-password-off', 'wrong-password')
    await click('Turn off')
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'That password is incorrect. Try again.'
    )
    expect(screen.getByText(/On\. Codes are required at sign-in/)).not.toBeNull()
  })

  it('regenerates backup codes behind a password confirmation', async () => {
    fake.twoFactor.generateBackupCodes.mockResolvedValue({
      data: { backupCodes: ['new-1111', 'new-2222'] }
    })
    await renderSecurity(true)
    await screen.findByText('GitHub')
    await password('twofactor-password-regen')
    await click('Regenerate backup codes')
    const codes = await screen.findByRole('region', { name: 'Backup codes' })
    expect(fake.twoFactor.generateBackupCodes).toHaveBeenCalledWith({
      password: 'correct-horse-battery-staple'
    })
    expect(codes.textContent).toContain('new-1111')
    expect(codes.textContent).toContain('new-2222')
    await click('I saved my codes')
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Backup codes' })).toBeNull()
    )
  })

  it('surfaces a failed backup-code regeneration without clearing the password state flip', async () => {
    fake.twoFactor.generateBackupCodes.mockResolvedValue({
      error: { code: 'INVALID_PASSWORD' }
    })
    await renderSecurity(true)
    await screen.findByText('GitHub')
    await password('twofactor-password-regen', 'wrong-password')
    await click('Regenerate backup codes')
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'That password is incorrect. Try again.'
    )
    expect(screen.queryByRole('region', { name: 'Backup codes' })).toBeNull()
  })

  it('treats an incomplete regeneration response as a failure', async () => {
    fake.twoFactor.generateBackupCodes.mockResolvedValue({ data: {} })
    await renderSecurity(true)
    await screen.findByText('GitHub')
    await password('twofactor-password-regen')
    await click('Regenerate backup codes')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('incomplete')
  })
})
