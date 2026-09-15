import { minimumTlsResponse } from '@b2b-saas-starter/env/transport'

type EdgeRequest = Request & {
  readonly cf?: { readonly tlsVersion?: string; readonly asn?: number }
}

/**
 * Cloudflare-origin fetches can omit the negotiated TLS version. Permit only
 * credential-free public signing-key discovery; this proves no TLS minimum.
 */
function permitsPublicKeyDiscovery(request: Request): boolean {
  const url = new URL(request.url)
  if (
    request.method !== 'GET' ||
    url.protocol !== 'https:' ||
    url.pathname !== '/api/auth/jwks' ||
    url.search !== '' ||
    request.headers.has('authorization') ||
    request.headers.has('cookie')
  ) {
    return false
  }
  // SAFETY: Cloudflare supplies these optional platform fields; caller headers are not read.
  // oxlint-disable-next-line effect/noAs -- Platform Request metadata is absent from the DOM Request type.
  const cf = (request as EdgeRequest).cf
  return cf?.tlsVersion === '' && cf.asn === 13_335
}

export function minimumWebTlsResponse(
  request: Request,
  environment?: string | null
): Response | undefined {
  if (permitsPublicKeyDiscovery(request)) {
    return undefined
  }
  return minimumTlsResponse(request, environment)
}
