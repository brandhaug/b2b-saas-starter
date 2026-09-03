import { describe, expect, it } from 'vite-plus/test'
import { consentRequest, scopeLabel, signedOAuthQuery } from './oauth-query'

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
    expect(scopeLabel('payments:write')).toBe('payments:write')
  })
})
