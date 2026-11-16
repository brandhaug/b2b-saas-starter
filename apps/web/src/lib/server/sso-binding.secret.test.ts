import { Effect, Redacted } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { webSsoBinding } from './sso-binding'

/**
 * The OIDC client secret crosses the capability into this adapter `Redacted`;
 * the plugin call's body is the one place it becomes plaintext. The plugin
 * call is captured, not performed: the assertion is the body the plugin gets.
 */
const sent = vi.hoisted((): Array<{ readonly oidcConfig?: object }> => [])

vi.mock('./plugin-call', () => {
  function capture(input: { readonly body: { readonly oidcConfig?: object } }) {
    sent.push(input.body)
    return Effect.void
  }
  return {
    sessionCall: (
      build: (
        api: {
          readonly registerSSOProvider: typeof capture
          readonly updateSSOProvider: typeof capture
        },
        headers: Headers
      ) => Effect.Effect<void>
    ) =>
      // oxlint-disable-next-line starter/no-run-promise-in-tests -- stands in for `sessionCall`, whose port is a Promise
      Effect.runPromise(
        build(
          { registerSSOProvider: capture, updateSSOProvider: capture },
          new Headers()
        )
      )
  }
})

const SECRET = 'oidc-client-plaintext'

describe('webSsoBinding client secret', () => {
  beforeEach(() => {
    sent.length = 0
  })

  it('reveals the redacted secret only in the register body', async () => {
    const input = {
      workspaceId: 'wrk_starter',
      providerId: 'sso_x',
      protocol: 'oidc' as const,
      domain: 'acme.com',
      issuer: 'https://login.acme.com',
      clientId: 'client-abcd',
      clientSecret: Redacted.make(SECRET),
      endpoints: {
        authorizationEndpoint: 'https://login.acme.com/authorize',
        tokenEndpoint: 'https://login.acme.com/token',
        jwksEndpoint: 'https://login.acme.com/jwks'
      },
      defaultWorkspaceRole: 'member' as const
    }
    // Inputs reach logs, spans and causes serialized.
    expect(JSON.stringify(input)).not.toContain(SECRET)
    await webSsoBinding.create(input)
    expect(sent).toMatchObject([{ oidcConfig: { clientSecret: SECRET } }])
  })

  it('reveals a rotated secret only in the update body', async () => {
    await webSsoBinding.update({
      providerId: 'sso_x',
      oidcCredentials: { clientId: 'client-new', clientSecret: Redacted.make(SECRET) }
    })
    expect(sent).toMatchObject([{ oidcConfig: { clientSecret: SECRET } }])
  })
})
