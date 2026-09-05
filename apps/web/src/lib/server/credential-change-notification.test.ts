import { describe, expect, it, vi } from 'vite-plus/test'
import { type AuthExchange } from './auth-audit/exchanges'
import {
  notifyCredentialChanged,
  type CredentialChangeSender
} from './credential-change-notification'

const BASE = 'http://localhost:3071/api/auth'

function post(pathname: string): AuthExchange {
  return { method: 'POST', pathname: `${BASE}${pathname}` }
}

function ok(): Response {
  return new Response(null, { status: 200 })
}

describe('notifyCredentialChanged', () => {
  const send = vi.fn<CredentialChangeSender>()

  function context(email?: string) {
    return email === undefined ? undefined : { actorUserId: 'usr_1', actorEmail: email }
  }

  it('emails the actor on a two-factor enable and disable, naming the direction', async () => {
    send.mockReset().mockResolvedValue(undefined)
    await notifyCredentialChanged(
      post('/two-factor/enable'),
      ok(),
      send,
      context('u@example.com')
    )
    expect(send).toHaveBeenCalledWith({
      email: 'u@example.com',
      change: { kind: 'two-factor', enabled: true }
    })

    await notifyCredentialChanged(
      post('/two-factor/disable'),
      ok(),
      send,
      context('u@example.com')
    )
    expect(send).toHaveBeenCalledWith({
      email: 'u@example.com',
      change: { kind: 'two-factor', enabled: false }
    })
  })

  it('emails the actor on a passkey add and remove, naming the direction', async () => {
    send.mockReset().mockResolvedValue(undefined)
    await notifyCredentialChanged(
      post('/passkey/verify-registration'),
      ok(),
      send,
      context('u@example.com')
    )
    expect(send).toHaveBeenCalledWith({
      email: 'u@example.com',
      change: { kind: 'passkey', added: true }
    })

    await notifyCredentialChanged(
      post('/passkey/delete-passkey'),
      ok(),
      send,
      context('u@example.com')
    )
    expect(send).toHaveBeenCalledWith({
      email: 'u@example.com',
      change: { kind: 'passkey', added: false }
    })
  })

  it('emails the actor on a backup-code rotation — saved codes die with it', async () => {
    send.mockReset().mockResolvedValue(undefined)
    await notifyCredentialChanged(
      post('/two-factor/generate-backup-codes'),
      ok(),
      send,
      context('u@example.com')
    )
    expect(send).toHaveBeenCalledWith({
      email: 'u@example.com',
      change: { kind: 'backup-codes' }
    })
  })

  it('emails the actor on a signed-in password change', async () => {
    send.mockReset().mockResolvedValue(undefined)
    await notifyCredentialChanged(
      post('/change-password'),
      ok(),
      send,
      context('u@example.com')
    )
    expect(send).toHaveBeenCalledWith({
      email: 'u@example.com',
      change: { kind: 'password' }
    })
  })

  it('stays silent on failures, sign-in exchanges, and renames', async () => {
    send.mockReset()
    await notifyCredentialChanged(
      post('/passkey/verify-registration'),
      new Response(null, { status: 400 }),
      send,
      context('u@example.com')
    )
    // Sign-in ceremonies open a session; they change no credential.
    await notifyCredentialChanged(
      post('/two-factor/verify-totp'),
      ok(),
      send,
      context('u@example.com')
    )
    await notifyCredentialChanged(
      post('/passkey/verify-authentication'),
      ok(),
      send,
      context('u@example.com')
    )
    // Renaming is a label change, not a credential change.
    await notifyCredentialChanged(
      post('/passkey/update-passkey'),
      ok(),
      send,
      context('u@example.com')
    )
    // The signed-in profile changes record audit rows but email nobody: a
    // name change is benign, and an email change mails its own verification.
    await notifyCredentialChanged(
      post('/update-user'),
      ok(),
      send,
      context('u@example.com')
    )
    await notifyCredentialChanged(
      post('/change-email'),
      ok(),
      send,
      context('u@example.com')
    )
    await notifyCredentialChanged(
      post('/passkey/verify-registration'),
      ok(),
      send,
      undefined
    )
    expect(send).not.toHaveBeenCalled()
  })

  it('swallows a dispatcher rejection — the exchange must not fail', async () => {
    send.mockReset().mockRejectedValue(new Error('down'))
    await expect(
      notifyCredentialChanged(
        post('/two-factor/enable'),
        ok(),
        send,
        context('u@example.com')
      )
    ).resolves.toBeUndefined()
  })
})
