import { type WorkspaceSsoBinding } from '@b2b-saas-starter/capabilities/governance/workspace-sso-connections'

import { sessionCall } from './plugin-call'

/** The register endpoint's body, as this adapter assembles it. */
type SsoRegisterBody = {
  providerId: string
  issuer: string
  domain: string
  organizationId: string
  enabled: boolean
  defaultWorkspaceRole: 'member' | 'admin'
  oidcConfig?: SsoOidcBody
  samlConfig?: SsoSamlBody
}

/** The plugin's stored OIDC config shape (its own schema validates it). */
type SsoOidcBody = {
  clientId: string
  clientSecret: string
  pkce: boolean
  skipDiscovery: boolean
  authorizationEndpoint: string
  tokenEndpoint: string
  jwksEndpoint: string
  userInfoEndpoint?: string
}

/** The plugin's stored SAML config shape (its own schema validates it). */
type SsoSamlBody = {
  entryPoint: string
  idpMetadata: { metadata: string }
}

/** The update endpoint's body, as this adapter assembles it. */
type SsoUpdateBody = {
  providerId: string
  enabled?: boolean | undefined
  requireSso?: boolean | undefined
  defaultWorkspaceRole?: 'member' | 'admin' | undefined
  oidcConfig?: { clientId: string; clientSecret: string }
}

/**
 * The web app's adapter onto the `sso` plugin's register/update/delete
 * endpoints — the app half of the `WorkspaceSsoBinding` port
 * (`@b2b-saas-starter/capabilities/governance/workspace-sso-connections`).
 * Every endpoint it wraps is session-gated (`sessionMiddleware`) and checks
 * the organization admin role itself, so every call goes through
 * `sessionCall` — the same shape as `invitation-binding.ts`, and for the same
 * reasons (see `./plugin-call.ts`).
 *
 * OIDC registrations are fully hydrated (`skipDiscovery` with explicit
 * endpoints) by the time they get here: the app's validation step resolved
 * them from the issuer, so the plugin never needs runtime discovery — whose
 * strict `trustedOrigins` check would otherwise make every IdP an operator
 * env change (ADR 0069).
 */
export const webSsoBinding: WorkspaceSsoBinding = {
  create: async (input) => {
    const body: SsoRegisterBody = {
      providerId: input.providerId,
      issuer: input.issuer,
      domain: input.domain,
      organizationId: input.workspaceId,
      // Connections are born disabled; the owner enables one after a
      // successful test (ADR 0069).
      enabled: false,
      defaultWorkspaceRole: input.defaultWorkspaceRole
    }
    if (input.protocol === 'oidc') {
      body.oidcConfig = {
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        // PKCE on: the plugin defaults it on, and a stated `true` cannot
        // drift when the default changes.
        pkce: true,
        skipDiscovery: true,
        authorizationEndpoint: input.endpoints.authorizationEndpoint,
        tokenEndpoint: input.endpoints.tokenEndpoint,
        jwksEndpoint: input.endpoints.jwksEndpoint
      }
      if (input.endpoints.userInfoEndpoint !== undefined) {
        body.oidcConfig.userInfoEndpoint = input.endpoints.userInfoEndpoint
      }
    } else {
      body.samlConfig = {
        entryPoint: input.entryPoint,
        idpMetadata: { metadata: input.metadataXml }
      }
    }
    await sessionCall((api, headers) => api.registerSSOProvider({ body, headers }))
  },
  update: async (input) => {
    // Rest keeps the optional fields exactly as the capability passed them;
    // only the credentials move, renamed to the plugin's `oidcConfig`. The
    // plugin merges a partial oidcConfig over the stored one, so a
    // credential rotation replaces exactly the pair it names.
    const { oidcCredentials, ...body } = input
    const pluginBody: SsoUpdateBody = { ...body }
    if (oidcCredentials !== undefined) {
      pluginBody.oidcConfig = {
        clientId: oidcCredentials.clientId,
        clientSecret: oidcCredentials.clientSecret
      }
    }
    await sessionCall((api, headers) =>
      api.updateSSOProvider({ body: pluginBody, headers })
    )
  },
  remove: async (input) => {
    await sessionCall((api, headers) =>
      api.deleteSSOProvider({ body: { providerId: input.providerId }, headers })
    )
  }
}
