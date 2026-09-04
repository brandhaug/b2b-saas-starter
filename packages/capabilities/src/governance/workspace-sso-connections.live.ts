import { workspaceSsoConnections } from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import { Effect, Layer, Option, Schema } from 'effect'
import { and, desc, eq } from 'drizzle-orm'

import { MembershipChangeRejected } from '../errors.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { AuditEventLog, recordInWorkspace } from './audit-event-log.ts'
import { makeBindingCaller } from './plugin-binding-failure.ts'
import {
  pickSignInTarget,
  requireProtocolMatch,
  SsoConnections,
  ssoAuditEvent,
  toRoutingDecision,
  type SsoConnection,
  type SsoConnectionDetail,
  type SsoRoutingFields,
  type WorkspaceSsoBinding
} from './workspace-sso-connections.ts'

const { callBinding } = makeBindingCaller<
  WorkspaceSsoBinding,
  MembershipChangeRejected
>({
  capability: 'workspace-sso-connections',
  noBindingReason: 'no_sso_binding',
  Rejected: MembershipChangeRejected
})

type ConnectionRow = typeof workspaceSsoConnections.$inferSelect

/**
 * What a stored config blob may hold, whichever protocol. Parsing through a
 * schema (not `JSON.parse` + probing) is the boundary: a malformed blob
 * degrades to `None` — "no config read" — rather than failing the whole
 * list, and the secret never leaves this module's Option.
 */
const StoredConfig = Schema.Struct({
  clientId: Schema.optional(Schema.String),
  authorizationEndpoint: Schema.optional(Schema.String),
  tokenEndpoint: Schema.optional(Schema.String),
  jwksEndpoint: Schema.optional(Schema.String),
  userInfoEndpoint: Schema.optional(Schema.String),
  entryPoint: Schema.optional(Schema.String),
  idpMetadata: Schema.optional(
    Schema.Struct({ metadata: Schema.optional(Schema.String) })
  )
})

const StoredConfigJson = Schema.fromJsonString(StoredConfig)
const readStoredConfig = Schema.decodeUnknownOption(StoredConfigJson)

function storedConfig(raw: string | null): Option.Option<typeof StoredConfig.Type> {
  if (raw === null) {
    return Option.none()
  }
  return readStoredConfig(raw)
}

/** The wire protocol a stored row speaks, decided once. */
function protocolOf(row: { readonly samlConfig: string | null }): 'oidc' | 'saml' {
  if (row.samlConfig === null) {
    return 'oidc'
  }
  return 'saml'
}

/** The routing fields the shared sign-in resolution reads off a stored row. */
function routingFields(row: ConnectionRow): SsoRoutingFields {
  return {
    id: row.providerId,
    protocol: protocolOf(row),
    domain: row.domain,
    workspaceId: row.workspaceId,
    enabled: row.enabled,
    requireSso: row.requireSso
  }
}

/**
 * Maps a stored row onto the wire DTO. The config blob is parsed for the
 * client id's last four only — the secret and every other config value stay
 * behind this boundary, which is what "secrets are write-only" means in
 * practice: no read path composes them.
 */
function toConnection(row: ConnectionRow): SsoConnection {
  const config = storedConfig(row.oidcConfig)
  let clientIdLastFour: string | null = null
  if (Option.isSome(config) && config.value.clientId !== undefined) {
    clientIdLastFour = config.value.clientId.slice(-4)
  }
  return {
    id: row.providerId,
    protocol: protocolOf(row),
    domain: row.domain,
    issuer: row.issuer,
    enabled: row.enabled,
    requireSso: row.requireSso,
    defaultWorkspaceRole: row.defaultWorkspaceRole,
    clientIdLastFour,
    createdAt: row.createdAt.toISOString()
  }
}

/** The OIDC half of `describe`, when the stored blob carries full endpoints. */
function oidcDetail(
  config: Option.Option<typeof StoredConfig.Type>
): SsoConnectionDetail['oidc'] {
  if (Option.isNone(config)) {
    return null
  }
  const parsed = config.value
  if (
    parsed.authorizationEndpoint === undefined ||
    parsed.tokenEndpoint === undefined ||
    parsed.jwksEndpoint === undefined
  ) {
    return null
  }
  return {
    authorizationEndpoint: parsed.authorizationEndpoint,
    tokenEndpoint: parsed.tokenEndpoint,
    jwksEndpoint: parsed.jwksEndpoint,
    userInfoEndpoint: parsed.userInfoEndpoint ?? null
  }
}

/** The SAML half of `describe`, when the stored blob carries the metadata. */
function samlDetail(
  config: Option.Option<typeof StoredConfig.Type>
): SsoConnectionDetail['saml'] {
  if (Option.isNone(config)) {
    return null
  }
  const parsed = config.value
  if (parsed.entryPoint === undefined || parsed.idpMetadata === undefined) {
    return null
  }
  if (parsed.idpMetadata.metadata === undefined) {
    return null
  }
  return {
    metadataXml: parsed.idpMetadata.metadata,
    entryPoint: parsed.entryPoint
  }
}

/**
 * The connection plus its testable protocol detail. A config blob that does
 * not parse (or lacks the endpoints) contributes a `null` segment rather than
 * failing the read — the test step reports the gap, the list still renders.
 * The protocol is decided once and only its own blob is parsed.
 */
function toDetail(row: ConnectionRow): SsoConnectionDetail {
  const protocol = protocolOf(row)
  if (protocol === 'saml') {
    const config = storedConfig(row.samlConfig)
    return { ...toConnection(row), oidc: null, saml: samlDetail(config) }
  }
  const config = storedConfig(row.oidcConfig)
  return { ...toConnection(row), oidc: oidcDetail(config), saml: null }
}

export function LiveSsoConnections(
  binding?: WorkspaceSsoBinding
): Layer.Layer<SsoConnections, never, Database | AuditEventLog> {
  return Layer.effect(SsoConnections)(
    Effect.gen(function* () {
      const db = yield* Database
      const audit = yield* AuditEventLog
      const unavailable = orUnavailable('workspace-sso-connections')

      /**
       * The connection read back through the same table `list` reads, scoped
       * to the workspace in context — never the plugin's response, which is
       * exactly the shape this package refuses to name.
       */
      const readInWorkspace = Effect.fnUntraced(function* (
        workspaceId: string,
        providerId: string
      ) {
        const rows = yield* unavailable(
          db
            .select()
            .from(workspaceSsoConnections)
            .where(
              and(
                eq(workspaceSsoConnections.workspaceId, workspaceId),
                eq(workspaceSsoConnections.providerId, providerId)
              )
            )
            .limit(1)
        )
        return Option.fromNullishOr(rows[0])
      })

      return {
        list: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const rows = yield* unavailable(
            db
              .select()
              .from(workspaceSsoConnections)
              .where(eq(workspaceSsoConnections.workspaceId, ctx.workspace.id))
              .orderBy(desc(workspaceSsoConnections.createdAt))
          )
          return rows.map(toConnection)
        }),
        get: ({ providerId }) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const row = yield* readInWorkspace(ctx.workspace.id, providerId)
            return Option.map(row, toConnection)
          }),
        describe: ({ providerId }) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const row = yield* readInWorkspace(ctx.workspace.id, providerId)
            return Option.map(row, toDetail)
          }),
        create: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const providerId = yield* newCapabilityId('sso')
            yield* callBinding(binding, (bound) =>
              bound.create({ ...input, workspaceId: ctx.workspace.id, providerId })
            )
            const row = yield* readInWorkspace(ctx.workspace.id, providerId)
            if (Option.isNone(row)) {
              return yield* Effect.fail(
                new MembershipChangeRejected({ reason: 'connection_not_created' })
              )
            }
            const connection = toConnection(row.value)
            yield* recordInWorkspace(audit, {
              ...ssoAuditEvent('created', connection),
              targetId: connection.id
            })
            return connection
          }),
        update: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const existing = yield* readInWorkspace(ctx.workspace.id, input.providerId)
            if (Option.isNone(existing)) {
              return Option.none<SsoConnection>()
            }
            yield* requireProtocolMatch(toConnection(existing.value), input)
            // The plugin merges a partial body over the stored row, so the
            // port's optional fields are exactly the fields being changed.
            const update = {
              providerId: input.providerId,
              ...(input.enabled !== undefined && { enabled: input.enabled }),
              ...(input.requireSso !== undefined && { requireSso: input.requireSso }),
              ...(input.defaultWorkspaceRole !== undefined && {
                defaultWorkspaceRole: input.defaultWorkspaceRole
              }),
              ...(input.oidcCredentials !== undefined && {
                oidcCredentials: input.oidcCredentials
              })
            }
            yield* callBinding(binding, (bound) => bound.update(update))
            const row = yield* readInWorkspace(ctx.workspace.id, input.providerId)
            const connection = Option.map(row, toConnection)
            if (Option.isSome(connection)) {
              yield* recordInWorkspace(audit, {
                ...ssoAuditEvent('updated', connection.value),
                targetId: connection.value.id
              })
            }
            return connection
          }),
        remove: ({ providerId }) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const existing = yield* readInWorkspace(ctx.workspace.id, providerId)
            if (Option.isNone(existing)) {
              return false
            }
            const connection = toConnection(existing.value)
            yield* callBinding(binding, (bound) => bound.remove({ providerId }))
            yield* recordInWorkspace(audit, {
              ...ssoAuditEvent('removed', connection),
              targetId: connection.id
            })
            return true
          }),
        resolveRouting: (email) =>
          Effect.gen(function* () {
            // Only enabled connections route — a disabled row persists for the
            // settings UI without intercepting sign-ins (the seeded example
            // connection depends on exactly this; the auth gate enforces the
            // same rule for direct `/sign-in/sso` calls).
            const rows = yield* unavailable(
              db
                .select()
                .from(workspaceSsoConnections)
                .where(eq(workspaceSsoConnections.enabled, true))
            )
            return Option.map(
              Option.fromNullishOr(
                pickSignInTarget(rows.map(routingFields), { email })
              ),
              toRoutingDecision
            )
          }),
        resolveSignInTarget: (input) =>
          Effect.gen(function* () {
            // Deliberately unfiltered by `enabled`: the gate needs to see a
            // disabled resolution to refuse it.
            const rows = yield* unavailable(db.select().from(workspaceSsoConnections))
            return Option.fromNullishOr(
              pickSignInTarget(rows.map(routingFields), input)
            )
          }),
        resolveProvider: (providerId) =>
          Effect.gen(function* () {
            const rows = yield* unavailable(
              db
                .select({
                  workspaceId: workspaceSsoConnections.workspaceId,
                  domain: workspaceSsoConnections.domain
                })
                .from(workspaceSsoConnections)
                .where(eq(workspaceSsoConnections.providerId, providerId))
                .limit(1)
            )
            return Option.fromNullishOr(rows[0])
          })
      }
    })
  )
}
