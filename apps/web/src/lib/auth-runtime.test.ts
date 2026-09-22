import { isRedirect } from '@tanstack/react-router'
import { describe, expect, it } from 'vite-plus/test'
import { authAvailability } from './auth-runtime'
import { requireSession } from './server/auth'
import { readSessionFromHeaders } from './server/auth-session-read'
import { handleAuth } from './server/auth-http'
import { serveOAuthDiscovery } from './server/oauth-discovery'
import { serverCall } from './server/plugin-call'
import { Effect } from 'effect'

const headers = new Headers({ cookie: 'better-auth.session_token=missing-db' })

describe('auth without D1', () => {
  it('represents unavailable persistence without a plugin runtime', () => {
    expect(authAvailability()).toEqual({ available: false })
  })

  it('answers anonymous even when a session cookie is supplied', async () => {
    expect(await readSessionFromHeaders(headers)).toBeNull()
  })

  it('redirects protected pages to sign-in', async () => {
    const refusal = await requireSession('/demo', () =>
      readSessionFromHeaders(headers)
    ).then(
      () => undefined,
      (error: unknown) => error
    )
    expect(isRedirect(refusal)).toBe(true)
  })

  it('answers guidance at auth and discovery HTTP boundaries', async () => {
    for (const handle of [handleAuth, serveOAuthDiscovery]) {
      const response = await handle(
        new Request('http://localhost/api/auth/sign-in/email')
      )
      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({ code: 'local_d1_unavailable' })
    }
  })

  it('rejects plugin calls before running their callback', async () => {
    let called = false
    await expect(
      serverCall(() => {
        called = true
        return Effect.void
      })
    ).rejects.toMatchObject({ _tag: 'MissingD1Binding' })
    expect(called).toBe(false)
  })
})
