import { hasValue, type ProviderEnvOf, type ServerEnv } from './server.ts'
import { classifyTrustedOrigin, trustedOriginEntries } from './trusted-origin.ts'

/** Minimum transport security accepted at a Cloudflare Worker boundary. */
export const MINIMUM_TLS_VERSION = 'TLSv1.2'

/**
 * Cloudflare supplies `request.cf.tlsVersion` for requests that arrived via
 * its edge. Local workerd and unit-test Requests do not carry the property,
 * so an absent value deliberately remains allowed for provider-light dev.
 */
export function tlsVersionIsAllowed(version: string | undefined): boolean {
  if (version === undefined) {
    return true
  }
  return version === 'TLSv1.2' || version === 'TLSv1.3'
}

export function requestTlsVersion(request: Request): string | undefined {
  // SAFETY: Cloudflare augments Request with an optional `cf` object; local
  // workerd and standard Requests omit it, which is why the field is optional.
  // oxlint-disable-next-line effect/noAs -- SAFETY: Cloudflare augments Request with the optional cf object; local workerd and standard Requests omit it.
  const cf = (request as Request & { readonly cf?: { readonly tlsVersion?: string } })
    .cf
  return cf?.tlsVersion
}

/** Return a response when a request negotiated a deprecated TLS version. */
export function minimumTlsResponse(
  request: Request,
  environment?: string | null
): Response | undefined {
  const version = requestTlsVersion(request)
  if (environment === 'production' && new URL(request.url).protocol !== 'https:') {
    return Response.json(
      { error: 'insecure_transport', minimum: MINIMUM_TLS_VERSION },
      { status: 426, headers: { upgrade: 'TLS/1.2' } }
    )
  }
  if (version !== undefined && tlsVersionIsAllowed(version)) {
    return undefined
  }
  // A production request must carry Cloudflare's TLS metadata. This prevents
  // an unobserved path from being treated as secure merely because the field
  // was stripped by a proxy or test harness.
  if (version === undefined && environment !== 'production') {
    return undefined
  }
  let error = 'tls_version_not_supported'
  if (version === undefined) {
    error = 'tls_version_unverified'
  }
  return Response.json(
    { error, minimum: MINIMUM_TLS_VERSION },
    { status: 426, headers: { upgrade: 'TLS/1.2' } }
  )
}

/** Absolute HTTPS endpoint validation for configured outbound services. */
export function isSecureEndpoint(value: string): boolean {
  const parsed = URL.parse(value)
  return (
    parsed?.protocol === 'https:' && parsed.username === '' && parsed.password === ''
  )
}

/** Sentry DSNs carry the public key in URL userinfo; passwords remain forbidden. */
export function isSecureDsn(value: string): boolean {
  const parsed = URL.parse(value)
  return parsed?.protocol === 'https:' && parsed.password === ''
}

// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
const secureEndpointKeys = [
  'BETTER_AUTH_URL',
  'BETTER_AUTH_TRUSTED_ORIGINS',
  'API_PUBLIC_URL',
  'MCP_RESOURCE_URL',
  'MCP_OAUTH_ISSUER',
  'SENTRY_DSN',
  'POSTHOG_HOST',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OPENAI_BASE_URL',
  'SECURITY_EVIDENCE_URL'
] as const satisfies ReadonlyArray<keyof ServerEnv>

export type SecureEndpointKey = (typeof secureEndpointKeys)[number]

export type SecureEndpointProblem = {
  readonly key: SecureEndpointKey
  readonly reason: 'malformed' | 'insecure'
}

type SecureEndpointEnv = ProviderEnvOf<SecureEndpointKey | 'ENVIRONMENT'>

type SecureEndpointSource = {
  readonly [K in keyof SecureEndpointEnv]?: SecureEndpointEnv[K] | null
}

/** Pure production audit for configured outbound endpoints. */
export function auditSecureEndpoints(
  source: SecureEndpointSource,
  environment: string | null | undefined
): ReadonlyArray<SecureEndpointProblem> {
  if (environment !== 'production') {
    return []
  }
  const problems: Array<SecureEndpointProblem> = []
  function check(
    key: SecureEndpointKey,
    value: string | null | undefined,
    dsn = false
  ): void {
    if (!hasValue(value)) {
      return
    }
    const parsed = URL.parse(value)
    if (parsed === null) {
      problems.push({ key, reason: 'malformed' })
      return
    }
    let valid = isSecureEndpoint(value)
    if (dsn) {
      valid = isSecureDsn(value)
    }
    if (!valid) {
      problems.push({ key, reason: 'insecure' })
    }
  }
  for (const key of secureEndpointKeys) {
    if (key !== 'BETTER_AUTH_TRUSTED_ORIGINS') {
      check(key, source[key], key === 'SENTRY_DSN')
    }
  }
  const origins = source.BETTER_AUTH_TRUSTED_ORIGINS
  if (hasValue(origins)) {
    for (const origin of trustedOriginEntries(origins)) {
      // A wildcard host (`*.example.com`) is the scheme-less form Better Auth
      // accepts. It carries no scheme to judge, so it is neither malformed nor
      // insecure — running it through `URL.parse` used to refuse every
      // production boot whose trusted origins Better Auth itself accepted.
      const kind = classifyTrustedOrigin(origin)
      if (kind === 'wildcard') {
        continue
      }
      // `isSecureEndpoint` stays the rule for anything with a scheme, so a
      // trusted origin is held to exactly what every other configured
      // endpoint is: https, and no userinfo.
      if (kind === 'https' && isSecureEndpoint(origin)) {
        continue
      }
      if (kind === 'malformed') {
        problems.push({ key: 'BETTER_AUTH_TRUSTED_ORIGINS', reason: 'malformed' })
        continue
      }
      problems.push({ key: 'BETTER_AUTH_TRUSTED_ORIGINS', reason: 'insecure' })
    }
  }
  return problems
}

/** Refuse production initialization when a configured endpoint is insecure. */
export function enforceSecureEndpoints(source: SecureEndpointSource): void {
  const problems = auditSecureEndpoints(source, source.ENVIRONMENT)
  if (problems.length === 0) {
    return
  }
  // oxlint-disable-next-line effect/noThrowStatement, effect/noNewError -- this runs at the Worker platform boundary before provider initialization and has no Effect error channel.
  throw new Error(
    `Refusing to initialize. Configured endpoints are insecure: ${problems
      .map((problem) => `${problem.key} (${problem.reason})`)
      .join(', ')}`
  )
}
