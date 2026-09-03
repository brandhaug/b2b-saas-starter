import { ssoProvisionedRoles } from '@b2b-saas-starter/db/enums'
import { Context, type Effect, type Option, Schema } from 'effect'

import { type CapabilityUnavailable, type MembershipChangeRejected } from '../errors.ts'
import { type WorkspaceContext } from '../workspace-context.ts'

/**
 * The workspace SSO connection contract: the wire schemas, the service tag, the
 * plugin binding port, and the domain-routing rule both adapters enforce. The
 * Seed adapter lives in
 * [`workspace-sso-connections.seed.ts`](./workspace-sso-connections.seed.ts),
 * the D1 + plugin-binding adapter in
 * [`workspace-sso-connections.live.ts`](./workspace-sso-connections.live.ts).
 *
 * A connection is a row Better Auth's `sso` plugin owns
 * (`workspace_sso_connections`, remapped from its `ssoProvider` model — ADR
 * 0054). The protocol flows (OIDC discovery round trips, SAML assertion
 * validation, user provisioning) live in the plugin; this capability owns the
 * workspace-scoped lifecycle, the sanitized read, and the routing decision the
 * sign-in page asks for.
 */

export const SsoProtocol = Schema.Literals(['oidc', 'saml'])
export type SsoProtocol = typeof SsoProtocol.Type

/** The provisioning roles a connection may hand a first-time SSO member. */
export const SsoProvisionedRole = Schema.Literals(ssoProvisionedRoles)
export type SsoProvisionedRole = typeof SsoProvisionedRole.Type

/**
 * A connection as the settings UI sees it — deliberately secret-free. The
 * protocol config blobs (which carry the OIDC client secret and the SAML
 * keys) are parsed for two display fields only: the client id's last four and
 * the SAML entry point. Everything else the UI shows comes from starter-owned
 * columns.
 */
export const SsoConnection = Schema.Struct({
  /** The plugin's `providerId` — the stable public id of the connection. */
  id: Schema.String,
  protocol: SsoProtocol,
  domain: Schema.String,
  issuer: Schema.String,
  enabled: Schema.Boolean,
  requireSso: Schema.Boolean,
  defaultWorkspaceRole: SsoProvisionedRole,
  /** Last four of the OIDC client id, so the form can echo it write-only. */
  clientIdLastFour: Schema.NullOr(Schema.String),
  createdAt: Schema.String
})
export type SsoConnection = typeof SsoConnection.Type

/** The endpoints an OIDC registration resolves from the issuer's discovery document. */
export type OidcEndpoints = {
  readonly authorizationEndpoint: string
  readonly tokenEndpoint: string
  readonly jwksEndpoint: string
  readonly userInfoEndpoint?: string | undefined
}

export type CreateOidcConnectionInput = {
  readonly protocol: 'oidc'
  readonly domain: string
  readonly issuer: string
  readonly clientId: string
  readonly clientSecret: string
  /**
   * Resolved by the app's test/discovery step before the connection is
   * registered, so the plugin stores a fully hydrated config and never needs
   * runtime discovery at sign-in (ADR 0055: the strict `trustedOrigins` check
   * the plugin applies to discovery URLs would otherwise make every IdP an
   * operator env change).
   */
  readonly endpoints: OidcEndpoints
  readonly defaultWorkspaceRole: SsoProvisionedRole
}

export type CreateSamlConnectionInput = {
  readonly protocol: 'saml'
  readonly domain: string
  /**
   * The SP entity id. The plugin stores the register body's top-level
   * `issuer` inside `samlConfig` as the service provider's identity and
   * generates SP metadata from it; the app derives it from its own origin,
   * which is the conventional stable choice when the starter serves one
   * deployment per workspace app.
   */
  readonly issuer: string
  /** The IdP's metadata XML (fetched from a metadata URL by the app, if given one). */
  readonly metadataXml: string
  /**
   * The IdP's SSO redirect URL, extracted from the metadata by the app's
   * validation step. The plugin's register body requires `entryPoint` as a
   * URL even when the metadata XML carries the same value.
   */
  readonly entryPoint: string
  readonly defaultWorkspaceRole: SsoProvisionedRole
}

export type CreateSsoConnectionInput =
  | CreateOidcConnectionInput
  | CreateSamlConnectionInput

/** A connection update: every field optional, `providerId` is the key. */
export type UpdateSsoConnectionInput = {
  readonly providerId: string
  readonly enabled?: boolean | undefined
  readonly requireSso?: boolean | undefined
  readonly defaultWorkspaceRole?: SsoProvisionedRole | undefined
  /**
   * Replaces the OIDC credentials. Secrets are write-only: the update carries
   * the new pair, no read path ever returns it.
   */
  readonly oidcCredentials?:
    | { readonly clientId: string; readonly clientSecret: string }
    | undefined
}

/**
 * What the sign-in page needs when an email's domain routes to a connection.
 * Identity-keyed like `WorkspaceInvitations.find`: it answers before any
 * workspace has been selected, for a person who may not be a member yet.
 */
export const SsoRoutingDecision = Schema.Struct({
  providerId: Schema.String,
  protocol: SsoProtocol,
  /** The workspace the connection belongs to. */
  workspaceId: Schema.String,
  /** True when that workspace refuses password sign-in for this domain. */
  requireSso: Schema.Boolean
})
export type SsoRoutingDecision = typeof SsoRoutingDecision.Type

/**
 * A connection plus the protocol detail its "test" needs — still secret-free:
 * OIDC endpoints and the SAML IdP metadata (public by definition) join the
 * sanitized fields, the client secret and any key material do not.
 */
export const SsoConnectionDetail = Schema.Struct({
  ...SsoConnection.fields,
  oidc: Schema.NullOr(
    Schema.Struct({
      authorizationEndpoint: Schema.String,
      tokenEndpoint: Schema.String,
      jwksEndpoint: Schema.String,
      userInfoEndpoint: Schema.NullOr(Schema.String)
    })
  ),
  saml: Schema.NullOr(
    Schema.Struct({
      metadataXml: Schema.String,
      entryPoint: Schema.String
    })
  )
})
export type SsoConnectionDetail = typeof SsoConnectionDetail.Type

export type SsoConnectionsInterface = {
  /** Every connection of the current workspace, newest first. */
  readonly list: Effect.Effect<
    ReadonlyArray<SsoConnection>,
    CapabilityUnavailable,
    WorkspaceContext
  >

  readonly get: (input: {
    readonly providerId: string
  }) => Effect.Effect<
    Option.Option<SsoConnection>,
    CapabilityUnavailable,
    WorkspaceContext
  >

  /** One connection with its protocol detail, for the test step. */
  readonly describe: (input: {
    readonly providerId: string
  }) => Effect.Effect<
    Option.Option<SsoConnectionDetail>,
    CapabilityUnavailable,
    WorkspaceContext
  >

  readonly create: (
    input: CreateSsoConnectionInput
  ) => Effect.Effect<
    SsoConnection,
    CapabilityUnavailable | MembershipChangeRejected,
    WorkspaceContext
  >

  /** Returns the updated connection, or `None` when no row matched. */
  readonly update: (
    input: UpdateSsoConnectionInput
  ) => Effect.Effect<
    Option.Option<SsoConnection>,
    CapabilityUnavailable | MembershipChangeRejected,
    WorkspaceContext
  >

  /**
   * Removes the connection (and, inside the plugin, its linked accounts).
   * `false` when no row matched in this workspace — no audit event either.
   */
  readonly remove: (input: {
    readonly providerId: string
  }) => Effect.Effect<
    boolean,
    CapabilityUnavailable | MembershipChangeRejected,
    WorkspaceContext
  >

  /**
   * The domain-routing rule (ADR 0055): the connection an email address
   * resolves to, if any. Only `enabled` connections route, and a disabled
   * connection never intercepts a sign-in even though its row persists —
   * which is what makes the seeded example connection safe.
   *
   * No `WorkspaceContext`, for the same reason `WorkspaceInvitations.find`
   * has none: the asker is on the public sign-in page and is not a member of
   * anything yet.
   */
  readonly resolveRouting: (
    email: string
  ) => Effect.Effect<Option.Option<SsoRoutingDecision>, CapabilityUnavailable>

  /**
   * One connection's workspace and domain, keyed by provider id — the
   * auth-catchall audit's lookup after an SSO callback, which knows only the
   * provider the IdP redirected back to. Identity-keyed like
   * `resolveRouting`; returns no config.
   */
  readonly resolveProvider: (
    providerId: string
  ) => Effect.Effect<
    Option.Option<{ readonly workspaceId: string; readonly domain: string }>,
    CapabilityUnavailable
  >
}

export class SsoConnections extends Context.Service<
  SsoConnections,
  SsoConnectionsInterface
>()('@b2b-saas-starter/capabilities/SsoConnections') {}

/**
 * The write half of SSO connections, as this package needs it — a structural
 * port onto the `sso` plugin's register/update/delete endpoints, which are
 * session-gated (`requireHeaders`) and org-admin-checked inside the plugin.
 * The app supplies the adapter (`apps/web/src/lib/server/sso-binding.ts`);
 * `capabilities` never names Better Auth (ADR 0051's rule, applied to the
 * second plugin).
 */
export type WorkspaceSsoBinding = {
  readonly create: (input: {
    readonly workspaceId: string
    readonly providerId: string
    readonly domain: string
    readonly issuer: string
    readonly defaultWorkspaceRole: SsoProvisionedRole
    readonly oidcConfig?:
      | {
          readonly clientId: string
          readonly clientSecret: string
          readonly endpoints: OidcEndpoints
        }
      | undefined
    readonly samlConfig?:
      | {
          readonly metadataXml: string
          /** The IdP SSO URL — required by the plugin's body schema even when the metadata XML carries it. */
          readonly entryPoint: string
        }
      | undefined
  }) => Promise<void>
  readonly update: (input: {
    readonly providerId: string
    readonly enabled?: boolean | undefined
    readonly requireSso?: boolean | undefined
    readonly defaultWorkspaceRole?: SsoProvisionedRole | undefined
    readonly oidcCredentials?:
      | { readonly clientId: string; readonly clientSecret: string }
      | undefined
  }) => Promise<void>
  readonly remove: (input: { readonly providerId: string }) => Promise<void>
}

/* -------------------------------------------------------------------------- */
/* The domain-routing rule                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The email half of domain routing: the lower-cased domain after the last `@`,
 * or `null` for an address with none (a bare local part, or an empty string).
 */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf('@')
  if (at === -1 || at === email.length - 1) {
    return null
  }
  return email.slice(at + 1).toLowerCase()
}
/**
 * Whether an email's domain is one of a connection's domains. The plugin
 * stores a comma-separated list so one IdP can serve several domains
 * (`company.com,subsidiary.com`); matching is exact and case-insensitive on
 * both sides, mirroring the plugin's own `domainMatches`.
 */
export function matchesEmailDomain(email: string, connectionDomains: string): boolean {
  const domain = emailDomain(email)
  if (domain === null) {
    return false
  }
  return connectionDomains
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .includes(domain)
}
