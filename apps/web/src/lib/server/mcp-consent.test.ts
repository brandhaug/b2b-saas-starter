// oxlint-disable-next-line import/no-unassigned-import -- Installs the explicit authenticated-session test fixture.
import '@/test/qualified-session'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { fixtureAuthModule } from '@/test/fixture-session'
import type * as AuthModule from './auth'

/**
 * The consent grant's own gate, over the real Seed capability layer (the
 * inert `cloudflare:workers` shim under Vitest selects it): the workspace the
 * browser picked has to be one the consenting user is a member of. A grant
 * that fell through that check would skip the suspension read below it and
 * hand the OAuth provider a consent scoped to a workspace the app never
 * authorized (ADR 0068). `usr_demo` is the seed owner of `wrk_starter`.
 */
const actor = vi.hoisted(() => ({ userId: 'usr_demo' }))
const plugin = vi.hoisted(() => ({ calls: new Array<string>() }))

vi.mock('./auth', async (importOriginal) =>
  fixtureAuthModule(await importOriginal<typeof AuthModule>(), actor)
)
vi.mock('./strong-authentication.effects', () => ({
  requireRecentAuthentication: async () => undefined
}))
// The provider's three hops: the grant must not reach them for a workspace
// the gate refuses, which is what the recorded calls prove.
vi.mock('./plugin-call', () => ({
  sessionCall: async () => {
    plugin.calls.push('provider')
    return { url: 'https://client.example/callback?code=abc' }
  }
}))

import { grantOAuthConsentHandler } from './mcp-consent.effects'

const input = {
  clientId: 'https://client.example/metadata.json',
  workspaceId: 'wrk_starter',
  oauthQuery: 'client_id=x&sig=abc'
}

beforeEach(() => {
  actor.userId = 'usr_demo'
  plugin.calls = []
})

describe('grantOAuthConsentHandler', () => {
  it('refuses a workspace the consenting user is not a member of', async () => {
    await expect(
      grantOAuthConsentHandler({ ...input, workspaceId: 'wrk_not_mine' })
    ).rejects.toMatchObject({ name: 'ForbiddenError' })

    expect(plugin.calls).toEqual([])
  })

  it('refuses a workspace the signed-in user has no membership row for', async () => {
    actor.userId = 'usr_stranger'

    await expect(grantOAuthConsentHandler(input)).rejects.toMatchObject({
      name: 'ForbiddenError'
    })

    expect(plugin.calls).toEqual([])
  })

  it('grants for a member of the picked workspace', async () => {
    const result = await grantOAuthConsentHandler(input)

    expect(result.url).toContain('code=abc')
    expect(plugin.calls.length).toBeGreaterThan(0)
  })
})
