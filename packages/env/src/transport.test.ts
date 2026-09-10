import { describe, expect, it } from 'vite-plus/test'
import {
  auditSecureEndpoints,
  enforceSecureEndpoints,
  isSecureDsn,
  isSecureEndpoint,
  minimumTlsResponse,
  type SecureEndpointKey,
  tlsVersionIsAllowed
} from './transport.ts'

function edgeRequest(url: string, tlsVersion: string): Request {
  const request = new Request(url)
  Object.defineProperty(request, 'cf', { value: { tlsVersion } })
  return request
}

describe('transport security gates', () => {
  it('accepts TLS 1.2 and newer at the production edge', () => {
    expect(tlsVersionIsAllowed(undefined)).toBe(true)
    expect(tlsVersionIsAllowed('TLSv1.2')).toBe(true)
    expect(tlsVersionIsAllowed('TLSv1.3')).toBe(true)
    expect(
      minimumTlsResponse(
        edgeRequest('https://api.example.test/', 'TLSv1.2'),
        'production'
      )
    ).toBeUndefined()
    expect(
      minimumTlsResponse(
        edgeRequest('https://api.example.test/', 'TLSv1.3'),
        'production'
      )
    ).toBeUndefined()
  })

  it('allows local HTTP requests without Cloudflare metadata', () => {
    expect(minimumTlsResponse(new Request('http://localhost/'))).toBeUndefined()
  })

  it.each(['TLSv1.1', 'SSLv3'])('rejects negotiated version %s', (tlsVersion) => {
    const response = minimumTlsResponse(
      edgeRequest('https://api.example.test/', tlsVersion),
      'production'
    )
    expect(response?.status).toBe(426)
    expect(response?.headers.get('upgrade')).toBe('TLS/1.2')
  })

  it('rejects production HTTP even when the edge reports an accepted TLS version', () => {
    expect(
      minimumTlsResponse(
        edgeRequest('http://api.example.test/', 'TLSv1.3'),
        'production'
      )?.status
    ).toBe(426)
  })

  it('requires Cloudflare TLS metadata in production and ignores forged headers', () => {
    const request = new Request('https://api.example.test/', {
      headers: {
        'cf-tls-version': 'TLSv1.3',
        'x-forwarded-proto': 'https'
      }
    })
    expect(minimumTlsResponse(request, 'production')?.status).toBe(426)
  })

  it('permits only credential-free HTTPS configured endpoints', () => {
    expect(isSecureEndpoint('https://evidence.example/v1')).toBe(true)
    expect(isSecureEndpoint('http://evidence.example/v1')).toBe(false)
    expect(isSecureEndpoint('https://user:pass@evidence.example/v1')).toBe(false)
    expect(isSecureEndpoint('not a URL')).toBe(false)
    expect(isSecureDsn('https://public@sentry.example/1')).toBe(true)
    expect(isSecureDsn('https://public:secret@sentry.example/1')).toBe(false)
  })

  const insecureEndpoints = [
    ['BETTER_AUTH_URL', 'http://auth.example.test'],
    ['BETTER_AUTH_TRUSTED_ORIGINS', 'http://*.trusted.example.test'],
    ['API_PUBLIC_URL', 'http://api.example.test'],
    ['MCP_RESOURCE_URL', 'http://api.example.test/mcp'],
    ['MCP_OAUTH_ISSUER', 'http://auth.example.test/api/auth'],
    ['SENTRY_DSN', 'http://public@sentry.example.test/1'],
    ['POSTHOG_HOST', 'http://analytics.example.test'],
    ['OTEL_EXPORTER_OTLP_ENDPOINT', 'http://telemetry.example.test/v1'],
    ['OPENAI_BASE_URL', 'http://ai.example.test/v1'],
    ['SECURITY_EVIDENCE_URL', 'http://evidence.example.test/v1']
  ] satisfies ReadonlyArray<readonly [SecureEndpointKey, string]>

  it.each(insecureEndpoints)(
    'reports configured insecure production endpoint %s without echoing its value',
    (key, value) => {
      const source = { [key]: value, ENVIRONMENT: 'production' }
      expect(auditSecureEndpoints(source, 'production')).toEqual([
        { key, reason: 'insecure' }
      ])
      expect(() => enforceSecureEndpoints(source)).toThrow(`${key} (insecure)`)
      expect(() => enforceSecureEndpoints(source)).not.toThrow(value)
    }
  )

  it.each([
    ['POSTHOG_HOST', '%%%'],
    ['SENTRY_DSN', 'https://[broken'],
    ['BETTER_AUTH_TRUSTED_ORIGINS', 'https://trusted.example.test,%%%']
  ] satisfies ReadonlyArray<readonly [SecureEndpointKey, string]>)(
    'reports malformed configured endpoint %s',
    (key, value) => {
      expect(auditSecureEndpoints({ [key]: value }, 'production')).toContainEqual({
        key,
        reason: 'malformed'
      })
    }
  )

  it('accepts HTTPS trusted-origin wildcards and audits each comma-separated origin', () => {
    expect(
      auditSecureEndpoints(
        {
          BETTER_AUTH_TRUSTED_ORIGINS:
            'https://*.example.test, https://admin.example.test'
        },
        'production'
      )
    ).toEqual([])
    expect(
      auditSecureEndpoints(
        {
          BETTER_AUTH_TRUSTED_ORIGINS:
            'https://*.example.test, http://admin.example.test'
        },
        'production'
      )
    ).toEqual([{ key: 'BETTER_AUTH_TRUSTED_ORIGINS', reason: 'insecure' }])
  })

  it("accepts Better Auth's scheme-less wildcard trusted origin in production", () => {
    const source = {
      BETTER_AUTH_TRUSTED_ORIGINS: '*.example.test, https://admin.example.test',
      ENVIRONMENT: 'production'
    }
    expect(auditSecureEndpoints(source, 'production')).toEqual([])
    expect(() => enforceSecureEndpoints(source)).not.toThrow()
    // A second `*` is not a form Better Auth accepts, so it stays malformed.
    expect(
      auditSecureEndpoints(
        { BETTER_AUTH_TRUSTED_ORIGINS: '*.*.example.test' },
        'production'
      )
    ).toEqual([{ key: 'BETTER_AUTH_TRUSTED_ORIGINS', reason: 'malformed' }])
  })

  it('refuses a trusted origin carrying embedded credentials', () => {
    for (const origins of [
      'https://user:pass@app.example.test',
      'https://token@app.example.test',
      'https://app.example.test, https://user:pass@admin.example.test'
    ]) {
      const source = {
        BETTER_AUTH_TRUSTED_ORIGINS: origins,
        ENVIRONMENT: 'production'
      }
      expect(auditSecureEndpoints(source, 'production')).toEqual([
        { key: 'BETTER_AUTH_TRUSTED_ORIGINS', reason: 'insecure' }
      ])
      expect(() => enforceSecureEndpoints(source)).toThrow(
        'BETTER_AUTH_TRUSTED_ORIGINS (insecure)'
      )
      expect(() => enforceSecureEndpoints(source)).not.toThrow('pass')
    }
  })

  it('preserves configured local HTTP endpoints and unset production providers', () => {
    expect(
      auditSecureEndpoints({ OPENAI_BASE_URL: 'http://ai.example' }, 'production')
    ).toEqual([{ key: 'OPENAI_BASE_URL', reason: 'insecure' }])
    expect(
      auditSecureEndpoints({ OPENAI_BASE_URL: 'http://localhost:1234' }, undefined)
    ).toEqual([])
    expect(auditSecureEndpoints({}, 'production')).toEqual([])
  })
})
