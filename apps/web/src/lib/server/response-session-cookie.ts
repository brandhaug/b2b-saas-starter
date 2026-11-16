/**
 * The session-token cookie(s) an auth response set, as a `cookie` header
 * value — the one reader for every post-handler step that must act on the
 * session the handler just minted (the two-factor gate reads and revokes it,
 * the SSO sign-in audit attributes it). Better Auth names it
 * `better-auth.session_token` (`__Secure-`-prefixed behind HTTPS); matching
 * the `session_token` fragment keeps both spellings one rule. Rotations are
 * joined in the order the response set them.
 */
export function responseSessionCookies(response: Response): string | null {
  const pairs: Array<string> = []
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';')[0]
    if (cookie.includes('session_token') && pair !== undefined) {
      pairs.push(pair)
    }
  }
  if (pairs.length === 0) {
    return null
  }
  return pairs.join('; ')
}
