import { Effect } from 'effect'
import { afterEach, describe, expect, it, vi } from '@effect/vitest'

import { resolveOidcIssuer, validateSamlMetadata } from './sso-discovery'

/**
 * The live IdP checks behind the settings form, without a network:
 * - the SAML half parses real metadata through the plugin's own parser;
 * - the OIDC half's failure path is the unreachable-Issuer case, which the
 *   mocked round trip in `packages/auth/src/sso.test.ts` covers from the
 *   success side.
 */

const METADATA = `<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata"
                  entityID="https://idp.acme.com/saml">
  <IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <KeyDescriptor><KeyInfo><X509Data><X509Certificate>MIIB</X509Certificate></X509Data></KeyInfo></KeyDescriptor>
    <SingleSignOnService
      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"
      Location="https://idp.acme.com/saml/sso"/>
    <SingleSignOnService
      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
      Location="https://idp.acme.com/saml/sso/post"/>
  </IDPSSODescriptor>
</EntityDescriptor>`

function metadataWithEntryPoint(
  entryPoint: string,
  entityId = 'https://idp.acme.com/saml'
) {
  return METADATA.replace('https://idp.acme.com/saml/sso', entryPoint).replace(
    'https://idp.acme.com/saml"',
    `${entityId}"`
  )
}

describe('validateSamlMetadata', () => {
  it.effect(
    'extracts the entity id and the redirect binding URL from valid metadata',
    () =>
      Effect.gen(function* () {
        const result = yield* validateSamlMetadata(METADATA)
        expect(result.entityId).toBe('https://idp.acme.com/saml')
        expect(result.entryPoint).toBe('https://idp.acme.com/saml/sso')
      })
  )

  it.effect('refuses metadata with no usable SSO service', () =>
    Effect.gen(function* () {
      // samlify parses garbage leniently — no entity id, no bindings — so the
      // refusal lands on the missing-entry-point code either way.
      const failure = yield* Effect.flip(
        validateSamlMetadata('this is not saml metadata')
      )
      expect(failure).toMatchObject({ code: 'saml_metadata_missing_entry_point' })
    })
  )

  it.effect('refuses metadata without an HTTP-Redirect SSO binding', () =>
    Effect.gen(function* () {
      const postOnly = METADATA.replace('HTTP-Redirect', 'HTTP-Custom-Binding')
      const failure = yield* Effect.flip(validateSamlMetadata(postOnly))
      expect(failure).toMatchObject({ code: 'saml_metadata_missing_entry_point' })
    })
  )
  it.effect('refuses an insecure or credential-bearing redirect binding', () =>
    Effect.gen(function* () {
      for (const entryPoint of [
        'http://idp.acme.com/saml/sso',
        'https://user:password@idp.acme.com/saml/sso'
      ]) {
        const failure = yield* Effect.flip(
          validateSamlMetadata(metadataWithEntryPoint(entryPoint))
        )
        expect(failure).toMatchObject({ code: 'saml_metadata_invalid' })
      }
    })
  )

  it.effect('allows non-URL SAML entity identifiers', () =>
    Effect.gen(function* () {
      const result = yield* validateSamlMetadata(
        metadataWithEntryPoint('https://idp.acme.com/saml/sso', 'urn:acme:idp')
      )
      expect(result.entityId).toBe('urn:acme:idp')
    })
  )
})

describe('resolveOidcIssuer', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.effect('fails discovery_unreachable for an issuer nothing answers', () =>
    Effect.gen(function* () {
      // No network in tests: `.invalid` never resolves, which is the same
      // refusal the form shows for a typo'd issuer.
      const failure = yield* Effect.flip(
        resolveOidcIssuer('https://login.unreachable.invalid')
      )
      expect(failure).toMatchObject({ code: 'discovery_unreachable' })
    })
  )

  it.effect('refuses an insecure issuer before making a request', () =>
    Effect.gen(function* () {
      const fetchSpy = vi.fn()
      vi.stubGlobal('fetch', fetchSpy)
      const failure = yield* Effect.flip(resolveOidcIssuer('http://idp.acme.com'))
      expect(failure).toMatchObject({ code: 'discovery_invalid' })
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  )

  it.effect(
    'refuses discovered endpoints that are not HTTPS credential-free URLs',
    () =>
      Effect.gen(function* () {
        const issuer = 'https://1.1.1.1'
        const valid = {
          issuer,
          authorization_endpoint: 'https://idp.acme.com/authorize',
          token_endpoint: 'https://idp.acme.com/token',
          jwks_uri: 'https://idp.acme.com/jwks'
        }
        const invalidFields = [
          ['authorization_endpoint', 'http://idp.acme.com/authorize'],
          ['jwks_uri', 'https://user:password@idp.acme.com/jwks']
        ] satisfies ReadonlyArray<readonly [keyof typeof valid, string]>
        for (const [field, value] of invalidFields) {
          vi.stubGlobal(
            'fetch',
            vi.fn(() =>
              Promise.resolve(
                new Response(JSON.stringify({ ...valid, [field]: value }))
              )
            )
          )
          const failure = yield* Effect.flip(resolveOidcIssuer(issuer))
          expect(failure).toMatchObject({ code: 'discovery_invalid' })
          vi.unstubAllGlobals()
        }
      })
  )

  it.effect('accepts a discovery document with secure endpoints', () =>
    Effect.gen(function* () {
      const issuer = 'https://1.1.1.1'
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                issuer,
                authorization_endpoint: 'https://idp.acme.com/authorize',
                token_endpoint: 'https://idp.acme.com/token',
                jwks_uri: 'https://idp.acme.com/jwks'
              })
            )
          )
        )
      )
      const endpoints = yield* resolveOidcIssuer(issuer)
      expect(endpoints.authorizationEndpoint).toBe('https://idp.acme.com/authorize')
    })
  )
})
