import { describe, expect, it } from 'vite-plus/test'
import { rejectClientMetadataUrl } from './client-metadata-fetch'

// The gate in front of every Client ID Metadata Document fetch: the plugin
// asks the transport to refuse non-public hosts, and this is the part of that
// promise a Worker can keep itself.
describe('rejectClientMetadataUrl', () => {
  it('lets a public https URL through', () => {
    expect(
      rejectClientMetadataUrl(
        'https://mcp-client.example.com/oauth/client-metadata.json'
      )
    ).toBeNull()
  })

  it('refuses plain http and credentials in the URL', () => {
    expect(rejectClientMetadataUrl('http://mcp-client.example.com/client.json')).toBe(
      'not_https'
    )
    expect(
      rejectClientMetadataUrl('https://user:pw@mcp-client.example.com/c.json')
    ).toBe('has_credentials')
  })

  it('refuses IP literals and non-public hosts', () => {
    expect(rejectClientMetadataUrl('https://10.0.0.5/client.json')).toBe('ip_literal')
    expect(rejectClientMetadataUrl('https://[::1]/client.json')).toBe('ip_literal')
    expect(rejectClientMetadataUrl('https://localhost/client.json')).toBe(
      'non_public_host'
    )
    expect(rejectClientMetadataUrl('https://metadata.internal/client.json')).toBe(
      'non_public_host'
    )
    expect(rejectClientMetadataUrl('https://intranet/client.json')).toBe(
      'non_public_host'
    )
  })

  it('refuses what is not a URL at all', () => {
    expect(rejectClientMetadataUrl('not a url')).toBe('malformed')
  })
})
