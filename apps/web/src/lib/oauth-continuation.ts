/**
 * When a sign-in (or the two-factor step that completes one) started from an
 * MCP client's authorization request, the page carries the provider's signed
 * OAuth query and `oauthProviderClient` attaches it to the auth call; the
 * provider then answers the sign-in with the authorization's next hop instead
 * of the session body (ADR 0054). This reads that hop off the opaque response.
 */
// oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- Better Auth's response `data` is untyped JSON at this boundary; these probes are the parse step (same as sign-in's `wantsTwoFactorRedirect`)
export function oauthContinuationUrl(data: unknown): string | null {
  if (
    typeof data !== 'object' ||
    data === null ||
    !('redirect' in data) ||
    data.redirect !== true ||
    !('url' in data) ||
    typeof data.url !== 'string'
  ) {
    return null
  }
  return data.url
}
// oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof

/**
 * The search string an auth-flow hop must carry forward so the signed OAuth
 * query survives it (sign-in → two-factor). Empty when the page carries none.
 *
 * Deliberately looser than `signedOAuthQuery` (lib/oauth-query.ts): this only
 * decides whether a hop has something OAuth-shaped to forward — the raw
 * search rides along verbatim, and the provider's signature check is what
 * rejects a malformed one.
 */
export function carriedOAuthSearch(search: string): string {
  return new URLSearchParams(search).has('sig') ? search : ''
}
