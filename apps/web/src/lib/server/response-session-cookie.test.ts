import { describe, expect, it } from 'vite-plus/test'

import { responseSessionCookies } from './response-session-cookie'

function withCookies(cookies: ReadonlyArray<string>): Response {
  const headers = new Headers()
  for (const cookie of cookies) {
    headers.append('set-cookie', cookie)
  }
  return new Response(null, { status: 200, headers })
}

describe('responseSessionCookies', () => {
  it('finds the better-auth session cookie among everything else the response set', () => {
    const cookie = responseSessionCookies(
      withCookies([
        'better-auth.session_token=jwt.token; Path=/; HttpOnly',
        'better-auth.csrf_token=csrf; Path=/',
        'better-auth.last_used_login_method=email; Path=/'
      ])
    )
    expect(cookie).toBe('better-auth.session_token=jwt.token')
  })

  it('matches the __Secure- prefixed spelling and joins rotations', () => {
    const cookie = responseSessionCookies(
      withCookies([
        '__Secure-better-auth.session_token=first; Path=/',
        '__Secure-better-auth.session_token=second; Path=/'
      ])
    )
    expect(cookie).toBe(
      '__Secure-better-auth.session_token=first; __Secure-better-auth.session_token=second'
    )
  })

  it('returns null when no session was minted — a failure redirect lands here too', () => {
    expect(
      responseSessionCookies(withCookies(['better-auth.csrf_token=csrf; Path=/']))
    ).toBeNull()
    expect(responseSessionCookies(new Response(null, { status: 302 }))).toBeNull()
  })
})
