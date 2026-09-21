import { describe, expect, it } from 'vite-plus/test'
import { consentRequest, scopeLabel, signedOAuthQuery } from './oauth-query'
import { defaultParseSearch, defaultStringifySearch } from '@tanstack/react-router'

describe('signedOAuthQuery', () => {
  it('keeps the signature, the signed-name list, and the named parameters only', () => {
    const search =
      '?client_id=https%3A%2F%2Fc.example%2Fm.json&scope=mcp%3Aread&redirect=%2Fx&ba_param=ba_param&ba_param=client_id&ba_param=scope&sig=abc'
    expect(signedOAuthQuery(search)).toBe(
      'client_id=https%3A%2F%2Fc.example%2Fm.json&scope=mcp%3Aread&ba_param=ba_param&ba_param=client_id&ba_param=scope&sig=abc'
    )
  })

  it('is null for a page query that carries no OAuth signature', () => {
    expect(signedOAuthQuery('?redirect=%2Fworkspaces')).toBeNull()
    expect(signedOAuthQuery('')).toBeNull()
  })

  it('restores router-serialized repeated fields while retaining signed values', () => {
    const original = new URLSearchParams({
      client_id: 'https://client.example/metadata.json',
      state: 'opaque+state/with=encoding',
      sig: 'authentic-signature'
    })
    for (const name of ['ba_param', 'client_id', 'resource', 'state']) {
      original.append('ba_param', name)
    }
    original.append('resource', 'https://api.example/assistant')
    original.append('resource', 'https://api.example/mcp')
    const routed = defaultStringifySearch(defaultParseSearch(`?${original}`))
    const restored = new URLSearchParams(
      signedOAuthQuery(`${routed}&redirect=/evil`) ?? ''
    )
    restored.sort()
    original.sort()
    expect([...restored]).toEqual([...original])
    expect(restored.has('redirect')).toBe(false)
  })

  it('refuses malformed router arrays without altering opaque signed JSON strings', () => {
    expect(signedOAuthQuery('?sig=x&ba_param=%5Bbroken')).toBeNull()
    expect(signedOAuthQuery('?sig=x&ba_param=%5B1%5D')).toBeNull()
    const params = new URLSearchParams({ sig: 'x', state: '["opaque"]' })
    params.append('ba_param', 'state')
    expect(
      new URLSearchParams(signedOAuthQuery(params.toString()) ?? '').get('state')
    ).toBe('["opaque"]')
  })
})

describe('consentRequest', () => {
  it('reads the client and splits the requested scopes', () => {
    expect(
      consentRequest({
        client_id: 'https://c.example/m.json',
        scope: 'openid mcp:read'
      })
    ).toEqual({ clientId: 'https://c.example/m.json', scopes: ['openid', 'mcp:read'] })
  })

  it('is null without a client', () => {
    expect(consentRequest({ scope: 'openid' })).toBeNull()
  })
})

describe('scopeLabel', () => {
  it('labels the known scopes and shows an unknown one raw', () => {
    expect(scopeLabel('mcp:read')).toBe('Read the workspace through the MCP server')
    expect(scopeLabel('mcp:write')).toContain('Change workspace data')
    expect(scopeLabel('payments:write')).toBe('payments:write')
  })
})
