import { describe, expect, it } from 'vite-plus/test'
import { minimumTlsResponse } from '@b2b-saas-starter/env/transport'
import { minimumWebTlsResponse } from './public-key-transport'

function incoming(
  path: string,
  options: {
    method?: string
    headers?: Record<string, string>
    version?: string
    asn?: number
  } = {}
) {
  const request = new Request(`https://issuer.example.test${path}`, options)
  Object.defineProperty(request, 'cf', {
    value: { tlsVersion: options.version ?? '', asn: options.asn ?? 13_335 }
  })
  return request
}

describe('public signing-key discovery transport', () => {
  it('permits the observed credential-free Worker fetch without changing the general gate', () => {
    const request = incoming('/api/auth/jwks')
    expect(minimumTlsResponse(request, 'production')?.status).toBe(426)
    expect(minimumWebTlsResponse(request, 'production')).toBeUndefined()
  })

  it.each([
    '/api/auth/jwks?token=untrusted',
    '/api/auth/jwks/',
    '/api/auth/get-session',
    '/api/assistant/conversation/connect',
    '/account'
  ])('preserves the transport gate for %s', (path) => {
    expect(minimumWebTlsResponse(incoming(path), 'production')?.status).toBe(426)
  })

  it('refuses credentials, mutations, old TLS and other network metadata', () => {
    for (const options of [
      { method: 'POST' },
      { method: 'HEAD' },
      { headers: { authorization: 'Bearer untrusted' } },
      { headers: { cookie: 'session=untrusted' } },
      { version: 'TLSv1.1' },
      { version: 'unknown' },
      { asn: 64_500 }
    ]) {
      expect(
        minimumWebTlsResponse(incoming('/api/auth/jwks', options), 'production')?.status
      ).toBe(426)
    }
  })

  it('refuses plain HTTP and forged headers without platform metadata', () => {
    const request = incoming('/api/auth/jwks')
    expect(
      minimumWebTlsResponse(
        new Request('http://issuer.example.test/api/auth/jwks', request),
        'production'
      )?.status
    ).toBe(426)
    expect(
      minimumWebTlsResponse(
        new Request('https://issuer.example.test/api/auth/jwks', {
          headers: { 'cf-asn': '13335', 'cf-tls-version': '' }
        }),
        'production'
      )?.status
    ).toBe(426)
  })
})
