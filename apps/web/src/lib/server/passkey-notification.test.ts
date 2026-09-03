import { describe, expect, it, vi } from 'vite-plus/test'
import { type AuthExchange } from './auth-audit/exchanges'
import { notifyPasskeyChanged } from './passkey-notification'

const BASE = 'http://localhost:3071/api/auth'

function post(pathname: string): AuthExchange {
  return { method: 'POST', pathname: `${BASE}${pathname}` }
}

function ok(): Response {
  return new Response(null, { status: 200 })
}

describe('notifyPasskeyChanged', () => {
  const send = vi.fn<(input: { email: string; added: boolean }) => Promise<void>>()

  function context(email?: string) {
    return email === undefined ? undefined : { actorUserId: 'usr_1', actorEmail: email }
  }

  it('emails the actor on a successful add and remove, naming the direction', async () => {
    send.mockReset().mockResolvedValue(undefined)
    await notifyPasskeyChanged(
      post('/passkey/verify-registration'),
      ok(),
      send,
      context('u@example.com')
    )
    expect(send).toHaveBeenCalledWith({ email: 'u@example.com', added: true })

    await notifyPasskeyChanged(
      post('/passkey/delete-passkey'),
      ok(),
      send,
      context('u@example.com')
    )
    expect(send).toHaveBeenCalledWith({ email: 'u@example.com', added: false })
  })

  it('stays silent on failures, sign-in exchanges, and renames', async () => {
    send.mockReset()
    await notifyPasskeyChanged(
      post('/passkey/verify-registration'),
      new Response(null, { status: 400 }),
      send,
      context('u@example.com')
    )
    // The sign-in ceremony opens a session; it changes no credential.
    await notifyPasskeyChanged(
      post('/passkey/verify-authentication'),
      ok(),
      send,
      context('u@example.com')
    )
    // Renaming is a label change, not a credential change.
    await notifyPasskeyChanged(
      post('/passkey/update-passkey'),
      ok(),
      send,
      context('u@example.com')
    )
    await notifyPasskeyChanged(
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
      notifyPasskeyChanged(
        post('/passkey/verify-registration'),
        ok(),
        send,
        context('u@example.com')
      )
    ).resolves.toBeUndefined()
  })
})
