/**
 * The signed OAuth query the provider redirects to the consent and sign-in
 * pages with (ADR 0068): the authorization request's own parameters plus
 * `exp`, `ba_iat`, `ba_param` (the names it signed) and `sig`. Both helpers are
 * pure and ship to the browser, so no Effect here.
 */

import { m } from '@b2b-saas-starter/i18n/messages'

const SIGNED_PARAMETER_NAMES = 'ba_param'

/**
 * Exactly the parameters the signature covers, as the `oauth_query` body field
 * the provider verifies. Mirrors `@better-auth/oauth-provider`'s internal
 * `buildSignedOAuthQuery` — which upstream does not export; if the two drift,
 * the provider rejects the query with a signature error (loud, not silent).
 * `null` when the page's query carries no signature at all.
 */
export function signedOAuthQuery(search: string): string | null {
  const params = new URLSearchParams(search)
  const signedNames = new Set(params.getAll(SIGNED_PARAMETER_NAMES))
  if (!params.has('sig') || signedNames.size === 0) {
    return null
  }
  const signed = new URLSearchParams()
  for (const [key, value] of params.entries()) {
    if (key === 'sig' || key === SIGNED_PARAMETER_NAMES || signedNames.has(key)) {
      signed.append(key, value)
    }
  }
  return signed.toString()
}

/** What the consent page shows: which client is asking, and for which scopes. */
export type ConsentRequest = {
  readonly clientId: string
  readonly scopes: ReadonlyArray<string>
}

export function consentRequest(search: {
  readonly client_id?: string | undefined
  readonly scope?: string | undefined
}): ConsentRequest | null {
  if (!search.client_id) {
    return null
  }
  return {
    clientId: search.client_id,
    scopes: (search.scope ?? '').split(' ').filter((scope) => scope.length > 0)
  }
}

/**
 * Human copy per OAuth scope. Anything the map does not know shows as its raw
 * name — a new scope must still be visible on the consent screen.
 */
export function scopeLabel(scope: string): string {
  switch (scope) {
    case 'openid': {
      return m.oauth_scope_openid()
    }
    case 'profile': {
      return m.oauth_scope_profile()
    }
    case 'email': {
      return m.oauth_scope_email()
    }
    case 'offline_access': {
      return m.oauth_scope_offline()
    }
    case 'mcp:read': {
      return m.oauth_scope_read()
    }
    case 'mcp:write': {
      return m.oauth_scope_write()
    }
    default: {
      return scope
    }
  }
}
