import { Effect } from 'effect'
import { describe, expect, it } from 'vite-plus/test'

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

describe('validateSamlMetadata', () => {
  it('extracts the entity id and the redirect binding URL from valid metadata', async () => {
    const result = await Effect.runPromise(validateSamlMetadata(METADATA))
    expect(result.entityId).toBe('https://idp.acme.com/saml')
    expect(result.entryPoint).toBe('https://idp.acme.com/saml/sso')
  })

  it('refuses metadata with no usable SSO service', async () => {
    // samlify parses garbage leniently — no entity id, no bindings — so the
    // refusal lands on the missing-entry-point code either way.
    const failure = await Effect.runPromise(
      Effect.flip(validateSamlMetadata('this is not saml metadata'))
    )
    expect(failure).toMatchObject({ code: 'saml_metadata_missing_entry_point' })
  })

  it('refuses metadata without an HTTP-Redirect SSO binding', async () => {
    const postOnly = METADATA.replace('HTTP-Redirect', 'HTTP-Custom-Binding')
    const failure = await Effect.runPromise(Effect.flip(validateSamlMetadata(postOnly)))
    expect(failure).toMatchObject({ code: 'saml_metadata_missing_entry_point' })
  })
})

describe('resolveOidcIssuer', () => {
  it('fails discovery_unreachable for an issuer nothing answers', async () => {
    // No network in tests: `.invalid` never resolves, which is the same
    // refusal the form shows for a typo'd issuer.
    const failure = await Effect.runPromise(
      Effect.flip(resolveOidcIssuer('https://login.unreachable.invalid'))
    )
    expect(failure).toMatchObject({ code: 'discovery_unreachable' })
  })
})
