import { ssoProvisionedRoles } from '@b2b-saas-starter/db/enums'
import { type JsonObject } from '@b2b-saas-starter/db/schema'
import { Context, Effect, type Option, Schema } from 'effect'

import { type CapabilityUnavailable, MembershipChangeRejected } from '../errors.ts'
import { type WorkspaceContext } from '../workspace-context.ts'
import { type AuditEventType, type AuditTargetType } from './audit-event-taxonomy.ts'

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
   * What one sign-in key resolves to, mirroring the plugin's own resolution —
   * `providerId` first, else the domain (the body's `domain` or the one after
   * an email's `@`), exact column match before a comma-list match — and
   * **including a disabled connection**, which the plugin's endpoint happily
   * serves. `resolveRouting` is this filtered to enabled rows; the auth gate
   * in `apps/web/src/lib/server/sso-sign-in-gate.ts` reads it raw and refuses
   * a disabled answer, so "a disabled connection never intercepts sign-ins"
   * holds at the boundary and not just on the page (ADR 0055 §2).
   */
  readonly resolveSignInTarget: (input: {
    readonly email?: string | undefined
    readonly domain?: string | undefined
    readonly providerId?: string | undefined
  }) => Effect.Effect<Option.Option<SsoSignInTarget>, CapabilityUnavailable>

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
 * second plugin). `create` carries the capability's own discriminated union
 * untouched, so a field added to a create input cannot silently vanish
 * between the adapters.
 */
export type WorkspaceSsoBinding = {
  readonly create: (
    input: CreateSsoConnectionInput & {
      readonly workspaceId: string
      readonly providerId: string
    }
  ) => Promise<void>
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
 * Whether a bare domain is one of a connection's domains. The plugin stores a
 * comma-separated list so one IdP can serve several domains
 * (`company.com,subsidiary.com`); matching is exact and case-insensitive on
 * both sides, mirroring the plugin's own `domainMatches`.
 */
export function matchesDomain(domain: string, connectionDomains: string): boolean {
  const needle = domain.trim().toLowerCase()
  if (needle === '') {
    return false
  }
  return connectionDomains
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .includes(needle)
}

/** Whether an email's domain is one of a connection's domains. */
export function matchesEmailDomain(email: string, connectionDomains: string): boolean {
  const domain = emailDomain(email)
  return domain !== null && matchesDomain(domain, connectionDomains)
}

/* -------------------------------------------------------------------------- */
/* The rules both adapters enforce                                            */
/* -------------------------------------------------------------------------- */

/**
 * OIDC credentials only ever update an OIDC connection. Written once so the
 * adapters cannot drift — the live plugin rejects the same call with a 400,
 * and refusing here keeps the Seed adapter identical instead of more lenient.
 */
export function requireProtocolMatch(
  connection: Pick<SsoConnection, 'protocol'>,
  input: UpdateSsoConnectionInput
): Effect.Effect<void, MembershipChangeRejected> {
  if (input.oidcCredentials !== undefined && connection.protocol === 'saml') {
    return Effect.fail(new MembershipChangeRejected({ reason: 'protocol_mismatch' }))
  }
  return Effect.void
}

/**
 * The lifecycle audit event for one connection — event type, target type and
 * metadata decided once, so the two adapters (and the taxonomy) cannot drift.
 * The adapters add `targetId` and record through `recordInWorkspace`.
 */
/** The audit write both adapters record for one lifecycle event, minus `targetId`. */
export type SsoAuditEvent = {
  readonly eventType: AuditEventType
  readonly targetType: AuditTargetType
  readonly metadata: JsonObject
}

export function ssoAuditEvent(
  kind: 'created' | 'updated' | 'removed',
  connection: SsoConnection
): SsoAuditEvent {
  switch (kind) {
    case 'created': {
      return {
        eventType: 'workspace_sso.connection_created',
        targetType: 'workspace_sso_connection',
        metadata: {
          protocol: connection.protocol,
          domain: connection.domain,
          defaultWorkspaceRole: connection.defaultWorkspaceRole
        }
      }
    }
    case 'updated': {
      return {
        eventType: 'workspace_sso.connection_updated',
        targetType: 'workspace_sso_connection',
        metadata: {
          enabled: connection.enabled,
          requireSso: connection.requireSso,
          defaultWorkspaceRole: connection.defaultWorkspaceRole
        }
      }
    }
    case 'removed': {
      return {
        eventType: 'workspace_sso.connection_removed',
        targetType: 'workspace_sso_connection',
        metadata: { protocol: connection.protocol, domain: connection.domain }
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* The sign-in resolution the routing rule and the auth gate share            */
/* -------------------------------------------------------------------------- */

/** What one sign-in key resolves to — enabled or not. */
export type SsoSignInTarget = {
  readonly providerId: string
  readonly protocol: SsoProtocol
  readonly workspaceId: string
  readonly domain: string
  readonly enabled: boolean
  readonly requireSso: boolean
}

/** The routing DTO `resolveRouting` answers: the sign-in target minus the fields only the auth gate reads. */
export function toRoutingDecision(target: SsoSignInTarget): SsoRoutingDecision {
  return {
    providerId: target.providerId,
    protocol: target.protocol,
    workspaceId: target.workspaceId,
    requireSso: target.requireSso
  }
}

/**
 * The fields the resolution reads off a stored connection. The live row and
 * the seed fixture both project onto this, which is what lets the pick below
 * be written once.
 */
export type SsoRoutingFields = {
  readonly id: string
  readonly protocol: SsoProtocol
  readonly domain: string
  readonly workspaceId: string
  readonly enabled: boolean
  readonly requireSso: boolean
}

/**
 * The resolution order both adapters enforce, mirroring the plugin's
 * `signInSSO`: a `providerId` addresses one connection outright; otherwise the
 * domain (the body's `domain`, or an email's domain) matches — the exact
 * column value before a comma-list entry, ties broken by lowest provider id.
 * Answers `undefined` for a key that matches nothing, and never looks at
 * `enabled`: the caller decides what a disabled answer means (the sign-in
 * page routes around it; the auth gate refuses it).
 */
export function pickSignInTarget(
  rows: ReadonlyArray<SsoRoutingFields>,
  input: {
    readonly email?: string | undefined
    readonly domain?: string | undefined
    readonly providerId?: string | undefined
  }
): SsoSignInTarget | undefined {
  if (input.providerId !== undefined) {
    const row = rows.find((candidate) => candidate.id === input.providerId)
    if (row === undefined) {
      return undefined
    }
    return toTarget(row)
  }
  let domain: string | null = null
  if (input.domain === undefined) {
    domain = emailDomain(input.email ?? '')
  } else {
    domain = input.domain
  }
  if (domain === null) {
    return undefined
  }
  const matches = rows.filter((row) => matchesDomain(domain, row.domain))
  const exact = matches.filter((row) => row.domain.trim().toLowerCase() === domain)
  // The plugin resolves the exact column value before scanning the
  // comma-list entries; lowest provider id breaks any remaining tie.
  let pool = matches
  if (exact.length > 0) {
    pool = exact
  }
  const match = pool.toSorted(byIdOrder)[0]
  if (match === undefined) {
    return undefined
  }
  return toTarget(match)
}

function byIdOrder(a: SsoRoutingFields, b: SsoRoutingFields): number {
  if (a.id < b.id) {
    return -1
  }
  if (a.id > b.id) {
    return 1
  }
  return 0
}

function toTarget(row: SsoRoutingFields): SsoSignInTarget {
  return {
    providerId: row.id,
    protocol: row.protocol,
    workspaceId: row.workspaceId,
    domain: row.domain,
    enabled: row.enabled,
    requireSso: row.requireSso
  }
}
