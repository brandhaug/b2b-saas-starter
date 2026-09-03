import {
  deriveSAMLIdentityProviderEntityID,
  fetchDiscoveryDocument,
  validateDiscoveryDocument
} from '@better-auth/sso'
import { Effect, Option, Result, Schema } from 'effect'
import { failureMessage } from '@b2b-saas-starter/failure'

import { type OidcEndpoints } from '@b2b-saas-starter/capabilities/governance/workspace-sso-connections'

/**
 * The live IdP checks behind the settings form's "Test" step and the OIDC
 * create flow (ADR 0054).
 *
 * Both halves run here, in the app, rather than inside the capability: the
 * discovery client is a vendor API call like billing's Stripe client, and the
 * capability's contract stays free of protocol knowledge beyond the endpoints
 * this module resolves. Registration then stores a fully hydrated OIDC config
 * (`skipDiscovery`), so no sign-in path ever re-runs discovery — whose strict
 * `trustedOrigins` check inside the plugin would otherwise make every new IdP
 * an operator env change instead of an owner's settings form.
 */

/** Why a test or a create-time validation refused a connection. */
export type SsoValidationError = {
  readonly code:
    | 'discovery_unreachable'
    | 'discovery_invalid'
    | 'saml_metadata_invalid'
    | 'saml_metadata_missing_entry_point'
  readonly message: string
}

/** The endpoints an issuer's discovery document resolves to. */
const DiscoveryEndpoints = Schema.Struct({
  issuer: Schema.String,
  authorization_endpoint: Schema.String,
  token_endpoint: Schema.String,
  jwks_uri: Schema.String,
  userinfo_endpoint: Schema.optional(Schema.String)
})

const decodeDiscoveryEndpoints = Schema.decodeUnknownOption(DiscoveryEndpoints)

function discoveryUrl(issuer: string): string {
  return `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`
}

/**
 * Resolves and validates an OIDC issuer: fetches its discovery document,
 * checks the issuer matches and the required endpoints exist. The plugin's
 * own SSRF guards (public-routable hosts, or a `trustedOrigins` entry for an
 * internal IdP) apply inside `fetchDiscoveryDocument`.
 */
export function resolveOidcIssuer(
  issuer: string
): Effect.Effect<OidcEndpoints, SsoValidationError> {
  return Effect.gen(function* () {
    const document = yield* Effect.tryPromise({
      try: () => fetchDiscoveryDocument(discoveryUrl(issuer)),
      catch: (error) =>
        ({
          code: 'discovery_unreachable',
          message: failureMessage(error)
        }) satisfies SsoValidationError
    })
    // Throws on an issuer mismatch or a missing required field; re-typed as
    // the module's own validation error.
    const validated = yield* Effect.result(
      Effect.try({
        try: () => validateDiscoveryDocument(document, issuer),
        catch: (error) => failureMessage(error)
      })
    )
    if (Result.isFailure(validated)) {
      return yield* Effect.fail({
        code: 'discovery_invalid',
        message: validated.failure
      } satisfies SsoValidationError)
    }
    const endpoints = decodeDiscoveryEndpoints(document)
    if (Option.isNone(endpoints)) {
      return yield* Effect.fail({
        code: 'discovery_invalid',
        message: 'The discovery document is missing required endpoints'
      } satisfies SsoValidationError)
    }
    const resolved: OidcEndpoints = {
      authorizationEndpoint: endpoints.value.authorization_endpoint,
      tokenEndpoint: endpoints.value.token_endpoint,
      jwksEndpoint: endpoints.value.jwks_uri
    }
    if (endpoints.value.userinfo_endpoint !== undefined) {
      return { ...resolved, userInfoEndpoint: endpoints.value.userinfo_endpoint }
    }
    return resolved
  })
}

/** The IdP half a SAML connection needs, extracted from its metadata XML. */
export type SamlMetadataSummary = {
  readonly entityId: string
  /** The HTTP-Redirect SSO URL — the plugin's register body requires it. */
  readonly entryPoint: string
}

/**
 * Validates SAML IdP metadata: the plugin's own parser (samlify) accepts it,
 * and the SSO redirect binding's URL is present.
 */
export function validateSamlMetadata(
  metadataXml: string
): Effect.Effect<SamlMetadataSummary, SsoValidationError> {
  return Effect.gen(function* () {
    // The parser only reads `idpMetadata`; the required config fields are
    // satisfied with placeholders the IdP-side parse never consults.
    const entityId = yield* Effect.try({
      try: () =>
        deriveSAMLIdentityProviderEntityID({
          issuer: 'sp-entity-id',
          entryPoint: 'https://placeholder.invalid/sso',
          idpMetadata: { metadata: metadataXml }
        }),
      catch: (error) =>
        ({
          code: 'saml_metadata_invalid',
          message: failureMessage(error)
        }) satisfies SsoValidationError
    })
    const entryPoint = extractRedirectBindingUrl(metadataXml)
    if (entryPoint === null) {
      return yield* Effect.fail({
        code: 'saml_metadata_missing_entry_point',
        message: 'The metadata declares no HTTP-Redirect SingleSignOnService binding'
      } satisfies SsoValidationError)
    }
    return { entityId, entryPoint }
  })
}

/**
 * Reads the HTTP-Redirect `SingleSignOnService` Location out of metadata XML.
 * Attribute order inside the element varies by IdP, so the element is matched
 * first and its `Location` read second.
 */
function extractRedirectBindingUrl(metadataXml: string): string | null {
  const elements = metadataXml.match(/<[^>]*SingleSignOnService[^>]*>/g) ?? []
  for (const element of elements) {
    if (!element.includes('HTTP-Redirect')) {
      continue
    }
    const location = /Location="([^"]+)"/.exec(element)?.[1]
    if (location !== undefined) {
      return location
    }
  }
  return null
}
