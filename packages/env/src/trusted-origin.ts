/**
 * One classifier for `BETTER_AUTH_TRUSTED_ORIGINS` entries, shared by the
 * required-env audit (`./server.ts`) and the secure-endpoint audit
 * (`./transport.ts`).
 *
 * Better Auth accepts two spellings, and the two audits used to disagree about
 * the second one: an absolute `http(s)` URL, and a scheme-less wildcard host
 * (`*.example.com`). Running the wildcard form through `URL.parse` calls it
 * malformed, which made the production endpoint audit refuse to initialize a
 * worker whose trusted origins Better Auth itself accepts.
 */

/** What one trusted-origin entry is, as far as both audits are concerned. */
export type TrustedOriginKind =
  /** Better Auth's scheme-less wildcard host, e.g. `*.example.com`. */
  | 'wildcard'
  | 'https'
  | 'http'
  /** An http(s) URL carrying userinfo — a credential in a config string. */
  | 'credentialed'
  /** Empty, not a URL, or a wildcard with a second `*` in the remainder. */
  | 'malformed'

/**
 * Classify one already-trimmed entry. A wildcard is a host pattern rather than
 * a URL, so it carries no scheme to judge: it is neither malformed nor
 * insecure, and the production audit leaves it alone.
 *
 * Userinfo is checked before the scheme, and on the same terms as
 * `isSecureEndpoint` in `./transport.ts`: `https://user:pass@host` is an
 * origin with a credential embedded in it, never an acceptable entry, and it
 * must not pass merely because its protocol reads `https:`.
 */
export function classifyTrustedOrigin(entry: string): TrustedOriginKind {
  if (entry.length === 0) {
    return 'malformed'
  }
  if (entry.startsWith('*.')) {
    if (entry.slice(2).includes('*')) {
      return 'malformed'
    }
    return 'wildcard'
  }
  // A `null` from `URL.parse` IS the answer here: the entry is not a URL.
  const parsed = URL.parse(entry)
  if (parsed === null) {
    return 'malformed'
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return 'malformed'
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return 'credentialed'
  }
  if (parsed.protocol === 'https:') {
    return 'https'
  }
  return 'http'
}

/** The comma-separated list, split and trimmed the way Better Auth reads it. */
export function trustedOriginEntries(value: string): ReadonlyArray<string> {
  return value.split(',').map((entry) => entry.trim())
}
