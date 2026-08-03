import { describe, expect, it } from 'vitest'
import { validateWebhookUrl } from './webhook-url.ts'

describe('validateWebhookUrl', () => {
  it('accepts public https destinations', () => {
    for (const url of [
      'https://example.com/hooks',
      'https://hooks.example.com:8443/hooks',
      'https://8.8.8.8/hooks',
      'https://172.15.0.1/',
      'https://172.32.0.1/'
    ])
      expect(validateWebhookUrl(url), url).toEqual({ valid: true })
  })

  it('rejects malformed, credentialed, fragmented, and oversized URLs', () => {
    for (const url of [
      'http://example.com/hooks',
      'wss://example.com/hooks',
      '%%%',
      'https://user:pass@example.com/',
      'https://user@example.com/',
      'https://example.com/hook#fragment',
      `https://example.com/${'x'.repeat(2049)}`
    ])
      expect(validateWebhookUrl(url).valid, url).toBe(false)
  })

  it('rejects private, loopback, link-local, and local hostnames', () => {
    for (const url of [
      'https://10.1.2.3/',
      'https://172.16.0.1/',
      'https://172.31.255.255/',
      'https://192.168.0.1/',
      'https://127.0.0.1/',
      'https://169.254.169.254/',
      'https://0.0.0.0/',
      'https://[::1]/',
      'https://[fc00::1]/',
      'https://[fe80::1]/',
      'https://[::ffff:10.0.0.1]/',
      'https://localhost/',
      'https://foo.localhost/',
      'https://internal/'
    ])
      expect(validateWebhookUrl(url).valid, url).toBe(false)
  })
})
