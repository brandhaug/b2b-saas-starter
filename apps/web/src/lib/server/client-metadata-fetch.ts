/**
 * The transport `@better-auth/cimd` fetches Client ID Metadata Documents with
 * (ADR 0054), for the Workers runtime. The plugin asks for four guarantees —
 * resolve the host once, refuse special-use addresses, pin the resolved
 * address, never follow redirects — and a Worker can give two of them
 * directly: redirects are returned unfollowed (`redirect: 'manual'`), and a
 * `client_id` naming an IP literal, loopback, or a non-public suffix is refused
 * before any request leaves. The other two are the platform's: Workers `fetch`
 * resolves and connects on Cloudflare's edge, where private ranges are not
 * routable and the runtime — not this code — owns the DNS answer. The Node
 * transport the package ships (`@better-auth/cimd/node`) pins sockets itself
 * and is not loadable on Workers.
 *
 * The function's shape is checked against the plugin's
 * `fetchClientMetadataResource` contract where it is consumed — the `mcp`
 * field of `AuthConfig` (`packages/auth`), which `auth-runtime.ts` feeds this
 * into.
 */

/** Hostnames a client metadata URL may never point at. */
const FORBIDDEN_HOST_SUFFIXES = [
  'localhost',
  '.localhost',
  '.local',
  '.internal',
  '.invalid',
  '.test',
  '.example'
]

const IPV4_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$/

export type ClientMetadataUrlRejection =
  | 'not_https'
  | 'ip_literal'
  | 'non_public_host'
  | 'has_credentials'
  | 'malformed'

/**
 * The pure gate: why a URL may not be fetched as a metadata document, or
 * `null` when it may. Exported for the test and for `isMetadataDocumentUrlAllowed`.
 */
export function rejectClientMetadataUrl(
  input: string
): ClientMetadataUrlRejection | null {
  const url = URL.parse(input)
  if (url === null) {
    return 'malformed'
  }
  if (url.protocol !== 'https:') {
    return 'not_https'
  }
  if (url.username || url.password) {
    return 'has_credentials'
  }
  const host = url.hostname.toLowerCase()
  if (IPV4_LITERAL.test(host) || host.startsWith('[')) {
    return 'ip_literal'
  }
  if (
    !host.includes('.') ||
    FORBIDDEN_HOST_SUFFIXES.some((suffix) =>
      suffix.startsWith('.') ? host.endsWith(suffix) : host === suffix
    )
  ) {
    return 'non_public_host'
  }
  return null
}

function requestUrl(input: RequestInfo | URL): string {
  if (input instanceof Request) {
    return input.url
  }
  if (input instanceof URL) {
    return input.href
  }
  // A bare string is the only remaining `RequestInfo` member.
  return input
}

export function fetchClientMetadataResource(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const rejection = rejectClientMetadataUrl(requestUrl(input))
  if (rejection !== null) {
    // oxlint-disable-next-line effect/noThrowStatement, effect/noNewError -- the CIMD transport contract signals a refused document by throwing `TypeError`, exactly what the package's Node transport does; the plugin awaits the call inside its own try/catch
    throw new TypeError(`client metadata URL refused: ${rejection}`)
  }
  return fetch(input, { ...init, redirect: 'manual' })
}
