import { describe, expect, it, vi } from 'vite-plus/test'
import {
  isTwoFactorChangeExchange,
  notifyTwoFactorChanged
} from './two-factor-notification'

const BASE = 'http://localhost:3071/api/auth'

function post(pathname: string): Request {
  return new Request(`${BASE}${pathname}`, { method: 'POST' })
}

function ok(): Response {
  return new Response(null, { status: 200 })
}

describe('isTwoFactorChangeExchange', () => {
  it('matches the enable and disable endpoints only', () => {
    expect(
      isTwoFactorChangeExchange({
        method: 'POST',
        pathname: `${BASE}/two-factor/enable`
      })
    ).toBe(true)
    expect(
      isTwoFactorChangeExchange({
        method: 'POST',
        pathname: `${BASE}/two-factor/disable`
      })
    ).toBe(true)
    // The sign-in challenge hop changes nothing about enrollment.
    expect(
      isTwoFactorChangeExchange({
        method: 'POST',
        pathname: `${BASE}/two-factor/verify-totp`
      })
    ).toBe(false)
    expect(
      isTwoFactorChangeExchange({
        method: 'GET',
        pathname: `${BASE}/two-factor/enable`
      })
    ).toBe(false)
  })
})

describe('notifyTwoFactorChanged', () => {
  const send = vi.fn<(input: { email: string; enabled: boolean }) => Promise<void>>()

  function context(email?: string) {
    return email === undefined ? undefined : { actorUserId: 'usr_1', actorEmail: email }
  }

  it('emails the actor on a successful enable, naming the direction', async () => {
    send.mockReset().mockResolvedValue(undefined)
    await notifyTwoFactorChanged(
      post('/two-factor/enable'),
      ok(),
      send,
      context('u@example.com')
    )
    expect(send).toHaveBeenCalledWith({ email: 'u@example.com', enabled: true })

    await notifyTwoFactorChanged(
      post('/two-factor/disable'),
      ok(),
      send,
      context('u@example.com')
    )
    expect(send).toHaveBeenCalledWith({ email: 'u@example.com', enabled: false })
  })

  it('stays silent on failures and non-two-factor exchanges', async () => {
    send.mockReset()
    await notifyTwoFactorChanged(
      post('/two-factor/enable'),
      new Response(null, { status: 400 }),
      send,
      context('u@example.com')
    )
    await notifyTwoFactorChanged(
      post('/sign-in/email'),
      ok(),
      send,
      context('u@example.com')
    )
    await notifyTwoFactorChanged(post('/two-factor/enable'), ok(), send, undefined)
    expect(send).not.toHaveBeenCalled()
  })

  it('swallows a dispatcher rejection — the exchange must not fail', async () => {
    send.mockReset().mockRejectedValue(new Error('down'))
    await expect(
      notifyTwoFactorChanged(
        post('/two-factor/enable'),
        ok(),
        send,
        context('u@example.com')
      )
    ).resolves.toBeUndefined()
  })
})
